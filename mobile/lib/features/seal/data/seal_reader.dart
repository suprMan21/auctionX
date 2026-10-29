import 'dart:async';
import 'dart:io' show Platform;

import 'package:ndef_record/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';

import 'seal_tap.dart';

/// Why a read didn't give a URL.
enum SealReadFailure { unavailable, cancelled, nothingRead }

class SealReadException implements Exception {
  const SealReadException(this.failure, [this.detail]);
  final SealReadFailure failure;
  final String? detail;
  @override
  String toString() => 'SealReadException($failure, $detail)';
}

/// Reads the URL off one seal. One call = one read of the chip's NDEF file
/// (the counter goes up by one per read; S-MOB2 checks this on device).
abstract class SealReader {
  Future<bool> isAvailable();

  /// [prompt] is shown on the iPhone's NFC sheet.
  Future<String> readUrl({required String prompt});

  void cancel();
}

class NfcSealReader implements SealReader {
  Completer<String>? _pending;

  @override
  Future<bool> isAvailable() async =>
      await NfcManager.instance.checkAvailability() == NfcAvailability.enabled;

  @override
  Future<String> readUrl({required String prompt}) async {
    if (!await isAvailable()) throw const SealReadException(SealReadFailure.unavailable);
    final done = Completer<String>();
    _pending = done;
    void fail(SealReadException e) {
      if (!done.isCompleted) done.completeError(e);
    }

    await NfcManager.instance.startSession(
      pollingOptions: {NfcPollingOption.iso14443},
      alertMessageIos: prompt,
      onDiscovered: (NfcTag tag) async {
        // Read once and stop: a second read would raise the counter again.
        String? url;
        try {
          final message = Platform.isIOS
              ? await NdefIos.from(tag)?.readNdef()
              : NdefAndroid.from(tag)?.cachedNdefMessage;
          final record = message?.records.isNotEmpty == true ? message!.records.first : null;
          if (record != null && record.typeNameFormat == TypeNameFormat.wellKnown) {
            url = uriFromRecordPayload(record.payload);
          }
        } catch (e) {
          fail(SealReadException(SealReadFailure.nothingRead, e.toString()));
        }
        if (url != null) {
          if (!done.isCompleted) done.complete(url);
          await NfcManager.instance.stopSession(alertMessageIos: 'Got it');
        } else {
          fail(const SealReadException(SealReadFailure.nothingRead));
          await NfcManager.instance.stopSession(errorMessageIos: 'That didn’t read as a seal');
        }
      },
      onSessionErrorIos: (error) => fail(SealReadException(SealReadFailure.cancelled, error.message)),
    );
    try {
      return await done.future;
    } finally {
      if (identical(_pending, done)) _pending = null;
    }
  }

  @override
  void cancel() {
    final pending = _pending;
    _pending = null;
    if (pending != null && !pending.isCompleted) {
      pending.completeError(const SealReadException(SealReadFailure.cancelled));
    }
    NfcManager.instance.stopSession(errorMessageIos: 'Cancelled');
  }
}
