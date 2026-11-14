import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../core/storage/secure_session_storage.dart';
import '../auth/data/auth_service.dart';
import 'data/pending_seal.dart';
import 'data/seal_api.dart';
import 'data/seal_sync.dart';
import 'data/seal_reader.dart';
import 'data/seal_video_store.dart';

final sealApiProvider = Provider<SealApi>((ref) => SealApi(ref.watch(apiClientProvider)));

/// The phone's NFC reader (tests use a fake).
final sealReaderProvider = Provider<SealReader>((_) => platformSealReader());

final pendingSealStoreProvider = Provider<PendingSealStore>((_) => PendingSealStore(PlatformSecureStore()));

final sealVideoStoreProvider = Provider<SealVideoStore>((_) => SealVideoStore());

/// The signed-in creator's seals that are still on this phone (waiting, sealed with the video still to
/// upload, or refused). Other accounts' entries stay in the store untouched.
class PendingSealsController extends AsyncNotifier<List<PendingSeal>> {
  List<PendingSeal> _all = [];

  String? get _owner {
    final auth = ref.read(authControllerProvider);
    return auth is SignedIn ? auth.user.id : null;
  }

  @override
  Future<List<PendingSeal>> build() async {
    ref.watch(authControllerProvider);
    _all = await ref.read(pendingSealStoreProvider).load();
    final dead = deadTakes(_all);
    if (dead.isNotEmpty) await _drop(dead);
    return _mine();
  }

  List<PendingSeal> _mine() {
    final owner = _owner;
    return [for (final s in _all) if (s.ownerId == owner) s];
  }

  Future<void> _write(List<PendingSeal> all) async {
    await ref.read(pendingSealStoreProvider).save(all);
    _all = all;
    state = AsyncData(_mine());
  }

  Future<void> add(PendingSeal seal) => _write([..._all, seal]);

  /// Removes entries and their videos.
  Future<void> _drop(List<PendingSeal> drop) async {
    final ids = {for (final s in drop) s.id};
    for (final s in drop) {
      await SealVideoStore.discard(s.videoPath);
    }
    await _write([for (final s in _all) if (!ids.contains(s.id)) s]);
  }

  /// Applies one commit attempt to the queue. A take the server says to record again can never
  /// finish, so it goes (with its video) straight away, wherever the creator goes next. Once a take is
  /// accepted, the creator's other takes on that seal go too: they could only be "already claimed".
  Future<void> settle(PendingSeal seal, CommitResult result) async {
    if (result.outcome == CommitOutcome.redo) {
      await _drop([seal]);
      return;
    }
    final updated = result.updated;
    if (updated == null) return;
    await replace(updated);
    final dead = deadTakes(_all);
    if (dead.isNotEmpty) await _drop(dead);
  }

  Future<void> replace(PendingSeal seal) => _write([for (final s in _all) s.id == seal.id ? seal : s]);

  /// Only for refused seals the creator dismissed: the video goes too.
  Future<void> dismiss(PendingSeal seal) => _drop([seal]);
}

final pendingSealsProvider =
    AsyncNotifierProvider<PendingSealsController, List<PendingSeal>>(PendingSealsController.new);
