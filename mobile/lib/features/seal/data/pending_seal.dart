import 'dart:convert';

import '../../../core/storage/secure_session_storage.dart';
import 'seal_tap.dart';

enum PendingSealState {
  /// Captured on the phone; the server hasn't accepted it yet.
  waiting,

  /// The server accepted the seal. The video still has to upload (Ph C).
  sealed,

  /// The server refused it for good (claimed, not one of ours, …). Kept so the creator sees why.
  refused,
}

/// A take the creator chose to seal: both taps, the video's fingerprint and where the file is.
///
/// Kept in the keychain until the server has it: the taps are the proof and can't be read again.
class PendingSeal {
  const PendingSeal({
    required this.id,
    required this.ownerId,
    required this.tap1,
    required this.tap2,
    required this.videoPath,
    required this.videoSha256,
    required this.createdAt,
    this.sessionId,
    this.appliedBeforeRecording = false,
    this.state = PendingSealState.waiting,
    this.sealId,
    this.refusedReason,
  });

  final String id;

  /// The account that recorded it. Another account signed in on the phone never sees it.
  final String ownerId;
  final SealTap tap1;
  final SealTap tap2;
  final String videoPath;
  final String videoSha256;
  final DateTime createdAt;
  final String? sessionId;
  final bool appliedBeforeRecording;
  final PendingSealState state;
  final String? sealId;
  final String? refusedReason;

  String get serial => tap1.serial;

  PendingSeal copyWith({PendingSealState? state, String? sealId, String? refusedReason}) => PendingSeal(
        id: id,
        ownerId: ownerId,
        tap1: tap1,
        tap2: tap2,
        videoPath: videoPath,
        videoSha256: videoSha256,
        createdAt: createdAt,
        sessionId: sessionId,
        appliedBeforeRecording: appliedBeforeRecording,
        state: state ?? this.state,
        sealId: sealId ?? this.sealId,
        refusedReason: refusedReason ?? this.refusedReason,
      );

  PendingSeal withoutSession() => PendingSeal(
        id: id,
        ownerId: ownerId,
        tap1: tap1,
        tap2: tap2,
        videoPath: videoPath,
        videoSha256: videoSha256,
        createdAt: createdAt,
        appliedBeforeRecording: appliedBeforeRecording,
        state: state,
        sealId: sealId,
        refusedReason: refusedReason,
      );

  /// The body of `POST /nfc/seal` (backend `sealCommitSchema`, strict: no other keys).
  Map<String, dynamic> commitBody() => {
        'serial': serial,
        'tap1': tap1.url,
        'tap2': tap2.url,
        'videoSha256': videoSha256,
        'tap1DeviceAt': tap1.readAt.toUtc().toIso8601String(),
        'tap2DeviceAt': tap2.readAt.toUtc().toIso8601String(),
        if (sessionId != null) 'sessionId': sessionId,
        if (appliedBeforeRecording) 'appliedBeforeRecording': true,
      };

  Map<String, dynamic> toJson() => {
        'id': id,
        'ownerId': ownerId,
        'tap1': tap1.toJson(),
        'tap2': tap2.toJson(),
        'videoPath': videoPath,
        'videoSha256': videoSha256,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'sessionId': sessionId,
        'appliedBeforeRecording': appliedBeforeRecording,
        'state': state.name,
        'sealId': sealId,
        'refusedReason': refusedReason,
      };

  factory PendingSeal.fromJson(Map<String, dynamic> json) => PendingSeal(
        id: json['id'] as String,
        ownerId: json['ownerId'] as String,
        tap1: SealTap.fromJson(json['tap1'] as Map<String, dynamic>),
        tap2: SealTap.fromJson(json['tap2'] as Map<String, dynamic>),
        videoPath: json['videoPath'] as String,
        videoSha256: json['videoSha256'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        sessionId: json['sessionId'] as String?,
        appliedBeforeRecording: json['appliedBeforeRecording'] as bool? ?? false,
        state: PendingSealState.values.firstWhere((s) => s.name == json['state'], orElse: () => PendingSealState.waiting),
        sealId: json['sealId'] as String?,
        refusedReason: json['refusedReason'] as String?,
      );
}

/// The on-phone queue, in the keychain (encrypted at rest, this device only).
class PendingSealStore {
  PendingSealStore(this._store);

  final KeyValueStore _store;
  static const key = 'am.pendingSeals';

  Future<List<PendingSeal>> load() async {
    final raw = await _store.read(key);
    if (raw == null) return [];
    try {
      final list = jsonDecode(raw) as List<dynamic>;
      return [for (final e in list) PendingSeal.fromJson(e as Map<String, dynamic>)];
    } catch (_) {
      // Never throw away proof silently: keep the unreadable copy beside it.
      await _store.write('$key.unreadable', raw);
      return [];
    }
  }

  Future<void> save(List<PendingSeal> seals) =>
      _store.write(key, jsonEncode([for (final s in seals) s.toJson()]));
}
