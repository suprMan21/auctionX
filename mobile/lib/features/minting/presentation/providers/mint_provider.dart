import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../nfc/presentation/providers/nfc_scan_provider.dart';
import '../../data/datasources/mint_remote_datasource.dart';
import '../../data/repositories/mint_repository_impl.dart';
import '../../domain/repositories/mint_repository.dart';
import 'mint_state.dart';

final mintRemoteDatasourceProvider = Provider<MintRemoteDatasource>((ref) {
  return MintRemoteDatasource(ref.watch(apiClientProvider));
});

final mintRepositoryProvider = Provider<MintRepository>((ref) {
  return MintRepositoryImpl(ref.watch(mintRemoteDatasourceProvider));
});

final mintNotifierProvider =
    StateNotifierProvider.autoDispose<MintNotifier, MintState>((ref) {
  return MintNotifier(ref.watch(mintRepositoryProvider));
});

class MintNotifier extends StateNotifier<MintState> {
  final MintRepository _repository;
  Timer? _timeoutTimer;

  MintNotifier(this._repository) : super(const MintState.idle());

  Future<void> startMint({required String tagId}) async {
    if (!mounted) return;
    state = const MintState.preparingMetadata();

    // Start timeout timer (60s)
    _timeoutTimer?.cancel();
    _timeoutTimer = Timer(const Duration(seconds: 60), () {
      if (mounted) {
        final isTerminal = state.when(
          idle: () => true,
          preparingMetadata: () => false,
          submittingTransaction: () => false,
          waitingConfirmation: () => false,
          success: (_) => true,
          error: (_) => true,
          timeout: () => true,
        );
        if (!isTerminal) {
          state = const MintState.timeout();
        }
      }
    });

    try {
      // Simulate step progression — backend does metadata + tx in one call
      await Future<void>.delayed(const Duration(milliseconds: 800));
      if (!mounted) return;
      state = const MintState.submittingTransaction();

      await Future<void>.delayed(const Duration(milliseconds: 500));
      if (!mounted) return;
      state = const MintState.waitingConfirmation();

      final result = await _repository.mintVerification(tagId: tagId);

      _timeoutTimer?.cancel();
      if (!mounted) return;

      result.fold(
        (failure) => state = MintState.error(failure.message),
        (mintResult) => state = MintState.success(mintResult),
      );
    } catch (e) {
      _timeoutTimer?.cancel();
      if (mounted) {
        state = MintState.error(e.toString());
      }
    }
  }

  void retry({required String tagId}) {
    startMint(tagId: tagId);
  }

  void reset() {
    _timeoutTimer?.cancel();
    state = const MintState.idle();
  }

  @override
  void dispose() {
    _timeoutTimer?.cancel();
    super.dispose();
  }
}
