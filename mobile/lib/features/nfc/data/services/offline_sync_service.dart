import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../datasources/nfc_local_datasource.dart';
import '../datasources/nfc_remote_datasource.dart';
import '../../presentation/providers/nfc_scan_provider.dart';

final offlineSyncServiceProvider = Provider<OfflineSyncService>((ref) {
  return OfflineSyncService(
    ref.watch(nfcRemoteDatasourceProvider),
    ref.watch(nfcLocalDatasourceProvider),
  );
});

class OfflineSyncService {
  final NfcRemoteDatasource _remote;
  final NfcLocalDatasource _local;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  OfflineSyncService(this._remote, this._local);

  void startListening() {
    _connectivitySub?.cancel();
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final hasConnection = results.any((r) => r != ConnectivityResult.none);
      if (hasConnection) {
        syncPending();
      }
    });
  }

  Future<void> syncPending() async {
    final unsynced = _local.getUnsyncedScans();
    for (final scan in unsynced) {
      try {
        await _remote.submitScan(
          tagUid: scan.tagUid,
          piccData: scan.piccData,
          cmac: scan.cmac,
        );
        if (scan.key != null) {
          await _local.markSynced(scan.key as int);
        }
      } catch (_) {
        // Will retry on next connectivity change
      }
    }
  }

  void dispose() {
    _connectivitySub?.cancel();
  }
}
