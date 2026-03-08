import 'package:freezed_annotation/freezed_annotation.dart';

part 'scan_result.freezed.dart';
part 'scan_result.g.dart';

@freezed
abstract class ScanResult with _$ScanResult {
  const factory ScanResult({
    required bool valid,
    required String tagId,
    String? eventId,
    int? counterValue,
  }) = _ScanResult;

  factory ScanResult.fromJson(Map<String, dynamic> json) =>
      _$ScanResultFromJson(json);
}
