import 'package:freezed_annotation/freezed_annotation.dart';

part 'registration_result.freezed.dart';
part 'registration_result.g.dart';

@freezed
sealed class RegistrationResult with _$RegistrationResult {
  const factory RegistrationResult({
    required String tagId,
    required String tagUid,
    required String itemId,
    required String status,
  }) = _RegistrationResult;

  factory RegistrationResult.fromJson(Map<String, dynamic> json) =>
      _$RegistrationResultFromJson(json);
}
