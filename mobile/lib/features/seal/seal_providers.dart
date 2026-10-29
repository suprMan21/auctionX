import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../core/storage/secure_session_storage.dart';
import '../auth/data/auth_service.dart';
import 'data/pending_seal.dart';
import 'data/seal_api.dart';
import 'data/seal_reader.dart';
import 'data/seal_video_store.dart';

final sealApiProvider = Provider<SealApi>((ref) => SealApi(ref.watch(apiClientProvider)));

/// The phone's NFC reader (tests use a fake).
final sealReaderProvider = Provider<SealReader>((_) => NfcSealReader());

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

  Future<void> replace(PendingSeal seal) => _write([for (final s in _all) s.id == seal.id ? seal : s]);

  /// Only for refused seals the creator dismissed: the video goes too.
  Future<void> dismiss(PendingSeal seal) async {
    await SealVideoStore.discard(seal.videoPath);
    await _write([for (final s in _all) if (s.id != seal.id) s]);
  }
}

final pendingSealsProvider =
    AsyncNotifierProvider<PendingSealsController, List<PendingSeal>>(PendingSealsController.new);
