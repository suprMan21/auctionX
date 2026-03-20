import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/mint_result.dart';

part 'mint_state.freezed.dart';

@freezed
abstract class MintState with _$MintState {
  const factory MintState.idle() = _Idle;
  const factory MintState.preparingMetadata() = _PreparingMetadata;
  const factory MintState.submittingTransaction() = _SubmittingTransaction;
  const factory MintState.waitingConfirmation() = _WaitingConfirmation;
  const factory MintState.success(MintResult result) = _Success;
  const factory MintState.error(String message) = _Error;
  const factory MintState.timeout() = _Timeout;
}
