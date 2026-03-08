import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/entities/pending_scan.dart';
import 'nfc_scan_provider.dart';

final scanHistoryProvider = Provider<List<PendingScan>>((ref) {
  final local = ref.watch(nfcLocalDatasourceProvider);
  return local.getPendingScans();
});
