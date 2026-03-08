import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/constants/api_constants.dart';
import '../../../../core/errors/failures.dart';
import '../../../../core/network/api_client.dart';
import '../../data/datasources/nfc_local_datasource.dart';
import '../../data/datasources/nfc_remote_datasource.dart';
import '../../data/repositories/nfc_repository_impl.dart';
import '../../data/services/nfc_service.dart';
import '../../domain/repositories/nfc_repository.dart';
import 'nfc_scan_state.dart';

final nfcServiceProvider = Provider<NfcService>((ref) {
  if (ApiConstants.kUseMockNfc) {
    return MockNfcService();
  }
  return NfcServiceImpl();
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient();
});

final nfcLocalDatasourceProvider = Provider<NfcLocalDatasource>((ref) {
  return NfcLocalDatasource();
});

final nfcRemoteDatasourceProvider = Provider<NfcRemoteDatasource>((ref) {
  return NfcRemoteDatasource(ref.watch(apiClientProvider));
});

final nfcRepositoryProvider = Provider<NfcRepository>((ref) {
  return NfcRepositoryImpl(
    ref.watch(nfcRemoteDatasourceProvider),
    ref.watch(nfcLocalDatasourceProvider),
  );
});

final nfcScanNotifierProvider =
    StateNotifierProvider<NfcScanNotifier, NfcScanState>((ref) {
  return NfcScanNotifier(
    ref.watch(nfcServiceProvider),
    ref.watch(nfcRepositoryProvider),
  );
});

class NfcScanNotifier extends StateNotifier<NfcScanState> {
  final NfcService _nfcService;
  final NfcRepository _repository;

  NfcScanNotifier(this._nfcService, this._repository)
      : super(const NfcScanState.idle());

  Future<void> startScan() async {
    // Check NFC availability
    state = const NfcScanState.checking();

    final available = await _nfcService.isAvailable();
    if (!available) {
      state = const NfcScanState.unavailable();
      return;
    }

    // Start NFC session
    state = const NfcScanState.scanning();

    try {
      final scanData = await _nfcService.startSession();
      state = const NfcScanState.reading();

      // Small delay to show reading state
      await Future<void>.delayed(const Duration(milliseconds: 300));
      state = const NfcScanState.validating();

      // Submit to backend
      final result = await _repository.submitScan(
        tagUid: scanData.tagUid,
        piccData: scanData.piccData,
        cmac: scanData.cmac,
      );

      result.fold(
        (failure) {
          if (failure is NetworkFailure) {
            state = const NfcScanState.savedOffline();
          } else {
            state = NfcScanState.error(failure.message);
          }
        },
        (scanResult) async {
          if (scanResult.valid) {
            state = NfcScanState.verified(scanResult);
            // Auto-fetch tag details
            final detailResult =
                await _repository.getTagDetail(scanResult.tagId);
            detailResult.fold(
              (_) {
                // Keep verified state even if detail fetch fails
              },
              (detail) {
                if (mounted) {
                  state = NfcScanState.verified(scanResult, detail: detail);
                }
              },
            );
          } else {
            state = NfcScanState.invalid(scanResult);
          }
        },
      );
    } catch (e) {
      if (e.toString().contains('Session cancelled')) {
        state = const NfcScanState.idle();
      } else {
        state = NfcScanState.error(e.toString());
      }
    }
  }

  /// Auto-validate from deep link params (no NFC session needed)
  Future<void> validateFromParams({
    required String piccData,
    required String cmac,
  }) async {
    state = const NfcScanState.validating();

    final tagUid = piccData.length >= 14
        ? piccData.substring(0, 14).toUpperCase()
        : piccData.toUpperCase();

    final result = await _repository.submitScan(
      tagUid: tagUid,
      piccData: piccData,
      cmac: cmac,
    );

    result.fold(
      (failure) {
        if (failure is NetworkFailure) {
          state = const NfcScanState.savedOffline();
        } else {
          state = NfcScanState.error(failure.message);
        }
      },
      (scanResult) async {
        if (scanResult.valid) {
          state = NfcScanState.verified(scanResult);
          final detailResult =
              await _repository.getTagDetail(scanResult.tagId);
          detailResult.fold(
            (_) {},
            (detail) {
              if (mounted) {
                state = NfcScanState.verified(scanResult, detail: detail);
              }
            },
          );
        } else {
          state = NfcScanState.invalid(scanResult);
        }
      },
    );
  }

  void cancelScan() {
    _nfcService.stopSession();
    state = const NfcScanState.idle();
  }

  void retry() {
    startScan();
  }

  void reset() {
    state = const NfcScanState.idle();
  }
}
