import 'dart:async';
import 'dart:io' show Platform;
import 'package:nfc_manager/nfc_manager.dart';
import 'package:nfc_manager/nfc_manager_android.dart';
import 'package:nfc_manager/nfc_manager_ios.dart';
import 'package:ndef_record/ndef_record.dart';

class NfcScanData {
  final String tagUid;
  final String piccData;
  final String cmac;
  final String rawUrl;

  const NfcScanData({
    required this.tagUid,
    required this.piccData,
    required this.cmac,
    required this.rawUrl,
  });
}

abstract class NfcService {
  Future<bool> isAvailable();
  Future<NfcScanData> startSession();
  void stopSession();
}

class NfcServiceImpl implements NfcService {
  Completer<NfcScanData>? _completer;

  @override
  Future<bool> isAvailable() async {
    final availability = await NfcManager.instance.checkAvailability();
    return availability == NfcAvailability.enabled;
  }

  @override
  Future<NfcScanData> startSession() {
    _completer = Completer<NfcScanData>();

    NfcManager.instance.startSession(
      pollingOptions: {NfcPollingOption.iso14443},
      alertMessageIos: 'Hold your iPhone near the NFC tag',
      onDiscovered: (NfcTag tag) async {
        try {
          NdefMessage? message;

          if (Platform.isAndroid) {
            message = await _readNdefAndroid(tag);
          } else if (Platform.isIOS) {
            message = await _readNdefIos(tag);
          }

          if (message == null || message.records.isEmpty) {
            _completer?.completeError('No NDEF records found');
            return;
          }

          final scanData = _parseNdefRecord(message.records.first);
          _completer?.complete(scanData);
        } catch (e) {
          _completer?.completeError(e.toString());
        } finally {
          NfcManager.instance.stopSession(
            alertMessageIos: 'Tag scanned successfully',
          );
        }
      },
      onSessionErrorIos: (error) {
        _completer?.completeError(error.message);
      },
    );

    return _completer!.future;
  }

  Future<NdefMessage?> _readNdefAndroid(NfcTag tag) async {
    final ndef = NdefAndroid.from(tag);
    if (ndef == null) return null;
    // Try cached message first, then read from tag
    return ndef.cachedNdefMessage ?? await ndef.getNdefMessage();
  }

  Future<NdefMessage?> _readNdefIos(NfcTag tag) async {
    final ndef = NdefIos.from(tag);
    if (ndef == null) return null;
    return await ndef.readNdef();
  }

  NfcScanData _parseNdefRecord(NdefRecord record) {
    final payload = String.fromCharCodes(record.payload);

    // URI record: first byte is prefix code (0x04 = https://)
    final url = payload.substring(1);
    final fullUrl = 'https://$url';

    final uri = Uri.parse(fullUrl);
    final piccData = uri.queryParameters['picc_data'] ?? '';
    final cmac = uri.queryParameters['cmac'] ?? '';

    if (piccData.isEmpty || cmac.isEmpty) {
      throw 'Invalid SUN URL: missing picc_data or cmac';
    }

    // Extract tag UID from picc_data (first 14 hex chars = 7-byte UID)
    final tagUid = piccData.length >= 14
        ? piccData.substring(0, 14).toUpperCase()
        : piccData.toUpperCase();

    return NfcScanData(
      tagUid: tagUid,
      piccData: piccData,
      cmac: cmac,
      rawUrl: fullUrl,
    );
  }

  @override
  void stopSession() {
    NfcManager.instance.stopSession(
      errorMessageIos: 'Scan cancelled',
    );
    if (_completer != null && !_completer!.isCompleted) {
      _completer!.completeError('Session cancelled');
    }
  }
}

class MockNfcService implements NfcService {
  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<NfcScanData> startSession() async {
    // Simulate NFC tap delay
    await Future<void>.delayed(const Duration(milliseconds: 1500));

    return const NfcScanData(
      tagUid: '04A23B6C7D8E9F',
      piccData: '04A23B6C7D8E9F0102030405060708',
      cmac: 'A1B2C3D4E5F6A7B8',
      rawUrl: 'https://authentic-materials.com/verify?picc_data=04A23B6C7D8E9F0102030405060708&cmac=A1B2C3D4E5F6A7B8',
    );
  }

  @override
  void stopSession() {
    // No-op for mock
  }
}
