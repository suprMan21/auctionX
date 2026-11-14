import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/services.dart';
import 'package:ndef_record/ndef_record.dart';
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';

import 'seal_tap.dart';

/// Why a read didn't give a URL.
enum SealReadFailure { unavailable, cancelled, nothingRead }

class SealReadException implements Exception {
  const SealReadException(this.failure, [this.detail, this.chipRead = false]);
  final SealReadFailure failure;
  final String? detail;

  /// The chip's file was read before the failure, so its counter moved: a take in progress
  /// can no longer be used (tap 2 must be tap 1 + 1).
  final bool chipRead;
  @override
  String toString() => 'SealReadException($failure, $detail, chipRead: $chipRead)';
}

/// Reads the URL off one seal. One call = one read of the chip's NDEF file
/// (the counter goes up by one per read; S-MOB2 checks this on device).
abstract class SealReader {
  Future<bool> isAvailable();

  /// [prompt] is shown on the iPhone's NFC sheet.
  Future<String> readUrl({required String prompt});

  void cancel();
}

/// SealReader for this platform: one ReadBinary on iOS, the system's NDEF read on Android.
SealReader platformSealReader() => Platform.isIOS ? ApduSealReader() : NfcSealReader();

/// iOS: native session in AppDelegate.swift (`am/seal_reader`) that selects the NDEF app and file
/// and sends one ReadBinary, so a tap is exactly +1. nfc_manager reads the file twice on its own
/// when it finds a tag, which made every tap +3 (2026-11-14).
class ApduSealReader implements SealReader {
  ApduSealReader([MethodChannel? channel]) : _channel = channel ?? const MethodChannel('am/seal_reader');
  final MethodChannel _channel;

  @override
  Future<bool> isAvailable() async => await _channel.invokeMethod<bool>('isAvailable') ?? false;

  @override
  Future<String> readUrl({required String prompt}) async {
    final Uint8List? file;
    try {
      file = await _channel.invokeMethod<Uint8List>('read', {'prompt': prompt});
    } on PlatformException catch (e) {
      final read = e.details is Map && (e.details as Map)['chipRead'] == true;
      final failure = switch (e.code) {
        'unavailable' => SealReadFailure.unavailable,
        'cancelled' || 'busy' => SealReadFailure.cancelled,
        _ => SealReadFailure.nothingRead,
      };
      throw SealReadException(failure, e.code, read);
    }
    final url = file == null ? null : urlFromNdefFile(file);
    if (url == null) throw const SealReadException(SealReadFailure.nothingRead, 'not_a_uri_record', true);
    return url;
  }

  @override
  void cancel() {
    _channel.invokeMethod<void>('cancel').ignore();
  }
}

/// Android: the system reads the NDEF file once when it finds the tag (`cachedNdefMessage`);
/// nothing here reads it again.
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
      onDiscovered: (NfcTag tag) async {
        // Never read again: a second read would raise the counter again.
        String? url;
        try {
          final message = NdefAndroid.from(tag)?.cachedNdefMessage;
          final record = message?.records.isNotEmpty == true ? message!.records.first : null;
          if (record != null && record.typeNameFormat == TypeNameFormat.wellKnown) {
            url = uriFromRecordPayload(record.payload);
          }
        } catch (e) {
          fail(SealReadException(SealReadFailure.nothingRead, e.toString(), true));
        }
        if (url != null) {
          if (!done.isCompleted) done.complete(url);
          await NfcManager.instance.stopSession();
        } else {
          // The system already read the file to hand us the tag.
          fail(const SealReadException(SealReadFailure.nothingRead, null, true));
          await NfcManager.instance.stopSession();
        }
      },
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
    NfcManager.instance.stopSession();
  }
}
