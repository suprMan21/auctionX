import 'package:hive/hive.dart';
import '../../domain/entities/pending_scan.dart';

class NfcLocalDatasource {
  static const _boxName = 'pending_scans';

  Box<PendingScan> get _box => Hive.box<PendingScan>(_boxName);

  Future<void> savePendingScan(PendingScan scan) async {
    await _box.add(scan);
  }

  List<PendingScan> getPendingScans() {
    return _box.values.toList()
      ..sort((a, b) => b.scannedAt.compareTo(a.scannedAt));
  }

  List<PendingScan> getUnsyncedScans() {
    return _box.values.where((s) => !s.synced).toList();
  }

  Future<void> markSynced(int key) async {
    final scan = _box.get(key);
    if (scan != null) {
      scan.synced = true;
      await scan.save();
    }
  }

  Future<void> clearSynced() async {
    final synced = _box.values.where((s) => s.synced).toList();
    for (final scan in synced) {
      await scan.delete();
    }
  }
}
