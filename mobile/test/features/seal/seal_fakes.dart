import 'dart:async';
import 'dart:collection';

import 'package:authentic_materials/features/seal/data/pending_seal.dart';
import 'package:authentic_materials/features/seal/data/seal_reader.dart';
import 'package:authentic_materials/features/seal/data/seal_tap.dart';
import 'package:authentic_materials/features/seal/data/take_recorder.dart';
import 'package:flutter/widgets.dart';

const serialA = '0123456789ABCDEF';
const serialB = 'FEDCBA9876543210';

/// A well-formed v2 seal URL (the MAC is never checked on the phone).
String sealUrl({String serial = serialA, String picc = 'A1B2C3D4E5F60718293A4B5C6D7E8F90', String cmac = '0011223344556677'}) =>
    'https://d1bwev65w7rqzl.cloudfront.net/verify/chip_005?sn=$serial&picc_data=$picc&cmac=$cmac';

PendingSeal pendingSeal({String id = 'take1', String owner = 'user-1', String? sessionId, bool applied = false}) =>
    PendingSeal(
      id: id,
      ownerId: owner,
      tap1: SealTap(url: sealUrl(), serial: serialA, readAt: DateTime.utc(2026, 10, 29, 20)),
      tap2: SealTap(url: sealUrl(picc: 'B1B2C3D4E5F60718293A4B5C6D7E8F90'), serial: serialA, readAt: DateTime.utc(2026, 10, 29, 20, 1, 30)),
      videoPath: '/tmp/none.mp4',
      videoSha256: 'a' * 64,
      createdAt: DateTime.utc(2026, 10, 29, 20, 2),
      sessionId: sessionId,
      appliedBeforeRecording: applied,
    );

/// Hands out queued URLs (or errors) one read at a time; waits when the queue is empty.
class FakeSealReader implements SealReader {
  final Queue<Object> results = Queue();
  final List<String> prompts = [];
  int cancels = 0;
  Completer<String>? _waiting;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<String> readUrl({required String prompt}) {
    prompts.add(prompt);
    if (results.isEmpty) {
      _waiting = Completer<String>();
      return _waiting!.future;
    }
    final next = results.removeFirst();
    return next is String ? Future.value(next) : Future.error(next);
  }

  @override
  void cancel() {
    cancels++;
    final w = _waiting;
    _waiting = null;
    if (w != null && !w.isCompleted) w.completeError(const SealReadException(SealReadFailure.cancelled));
  }
}

class FakeRecorder implements TakeRecorder {
  bool recording = false;
  int starts = 0;
  int stops = 0;
  String path = '/nonexistent/take.mp4';

  @override
  Future<void> init() async {}

  @override
  Widget preview() => const SizedBox.expand();

  @override
  bool get canFlip => false;

  @override
  Future<void> flip() async {}

  @override
  Future<void> start() async {
    recording = true;
    starts++;
  }

  @override
  Future<String> stop() async {
    recording = false;
    stops++;
    return path;
  }

  @override
  Future<void> dispose() async {}
}
