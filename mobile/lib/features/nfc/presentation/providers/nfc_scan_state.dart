import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/scan_result.dart';
import '../../domain/entities/tag_detail.dart';

part 'nfc_scan_state.freezed.dart';

@freezed
sealed class NfcScanState with _$NfcScanState {
  const factory NfcScanState.idle() = _Idle;
  const factory NfcScanState.checking() = _Checking;
  const factory NfcScanState.scanning() = _Scanning;
  const factory NfcScanState.reading() = _Reading;
  const factory NfcScanState.validating() = _Validating;
  const factory NfcScanState.verified(ScanResult result, {TagDetail? detail}) = _Verified;
  const factory NfcScanState.invalid(ScanResult result) = _Invalid;
  const factory NfcScanState.savedOffline() = _SavedOffline;
  const factory NfcScanState.error(String message) = _Error;
  const factory NfcScanState.unavailable() = _Unavailable;
}
