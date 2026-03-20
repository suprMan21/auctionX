import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/registration_result.dart';

part 'registration_wizard_state.freezed.dart';

@freezed
sealed class RegistrationWizardState with _$RegistrationWizardState {
  const factory RegistrationWizardState.selectListing() = _SelectListing;
  const factory RegistrationWizardState.scanTag({
    required String listingId,
    required String listingTitle,
  }) = _ScanTag;
  const factory RegistrationWizardState.enterKey({
    required String listingId,
    required String listingTitle,
    required String tagUid,
  }) = _EnterKey;
  const factory RegistrationWizardState.confirming({
    required String listingId,
    required String listingTitle,
    required String tagUid,
    required String aesKey,
  }) = _Confirming;
  const factory RegistrationWizardState.success(RegistrationResult result) =
      _Success;
  const factory RegistrationWizardState.error(String message) = _Error;
}
