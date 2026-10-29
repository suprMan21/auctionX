import 'dart:convert';
import 'dart:io';

import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/seal/data/pending_seal.dart';
import 'package:authentic_materials/features/seal/data/seal_api.dart';
import 'package:authentic_materials/features/seal/data/seal_sync.dart';
import 'package:authentic_materials/features/seal/data/seal_tap.dart';
import 'package:authentic_materials/features/seal/data/seal_video_store.dart';
import 'package:authentic_materials/features/seal/data/take_rules.dart';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../core/api_client_test.dart' show FakeAdapter, client;
import '../../core/secure_session_storage_test.dart' show MemoryStore;
import 'seal_fakes.dart';

SealApi sealApiWith(FakeAdapter adapter) => SealApi(ApiClient(
      baseUrl: 'https://api.example.com/api/v1',
      client: client,
      accessToken: () => 'tok',
      dio: Dio()..httpClientAdapter = adapter,
    ));

Map<String, dynamic> refused(String reason, {String code = 'failed_precondition'}) =>
    {'success': false, 'error': 'nope', 'code': code, 'reason': reason};

final at = DateTime.utc(2026, 10, 29, 20);

void main() {
  group('seal tap', () {
    test('reads the serial out of a v2 seal URL and keeps the URL as is', () {
      final url = sealUrl();
      final tap = parseSealTap(url, at);
      expect(tap.serial, serialA);
      expect(tap.url, url);
      expect(tap.readAt, at);
    });

    test('lowercase serial is uppercased (the server compares uppercase)', () {
      expect(parseSealTap(sealUrl(serial: serialA.toLowerCase()), at).serial, serialA);
    });

    test('a v1 chip (no serial) is an older kind, not a seal problem', () {
      const v1 = 'https://x.test/verify/chip_001?picc_data=A1B2C3D4E5F60718293A4B5C6D7E8F90&cmac=0011223344556677';
      expect(() => parseSealTap(v1, at),
          throwsA(isA<SealTapException>().having((e) => e.problem, 'problem', SealTapProblem.oldChip)));
    });

    test('anything else is not a seal', () {
      for (final bad in [
        'not a url',
        'mailto:a@b.co',
        'https://x.test/verify/a?sn=$serialA',
        'https://x.test/verify/a?sn=$serialA&picc_data=ZZ&cmac=0011223344556677',
        'https://x.test/verify/a?sn=$serialA&picc_data=A1B2&cmac=0011223344556677',
      ]) {
        expect(() => parseSealTap(bad, at),
            throwsA(isA<SealTapException>().having((e) => e.problem, 'problem', SealTapProblem.notASeal)),
            reason: bad);
      }
    });

    test('URI record prefixes', () {
      expect(uriFromRecordPayload([0x04, ...'x.test/a'.codeUnits]), 'https://x.test/a');
      expect(uriFromRecordPayload([0x02, ...'x.test'.codeUnits]), 'https://www.x.test');
      expect(uriFromRecordPayload([0x00, ...'https://x.test'.codeUnits]), 'https://x.test');
      expect(uriFromRecordPayload([0x23, 0x41]), isNull);
      expect(uriFromRecordPayload([]), isNull);
    });

    test('serial suffix is the last four', () => expect(serialSuffix(serialA), 'CDEF'));
  });

  group('take rules', () {
    test('warn at 1:45, over at 2:00', () {
      expect(recordingPhase(const Duration(seconds: 104)), RecordingPhase.normal);
      expect(recordingPhase(const Duration(seconds: 105)), RecordingPhase.warning);
      expect(recordingPhase(const Duration(milliseconds: 119999)), RecordingPhase.warning);
      expect(recordingPhase(const Duration(minutes: 2)), RecordingPhase.over);
    });

    test('seconds left counts down to 0 and never below', () {
      expect(secondsLeft(const Duration(seconds: 105)), 15);
      expect(secondsLeft(const Duration(milliseconds: 105500)), 15);
      expect(secondsLeft(const Duration(minutes: 3)), 0);
    });

    test('clock and same seal', () {
      expect(clock(const Duration(seconds: 65)), '1:05');
      expect(clock(Duration.zero), '0:00');
      expect(sameSeal(serialA, serialA), isTrue);
      expect(sameSeal(serialA, serialB), isFalse);
    });
  });

  group('pending seal', () {
    test('commit body matches the backend schema exactly (strict: no other keys)', () {
      final body = pendingSeal().commitBody();
      expect(body.keys.toSet(), {'serial', 'tap1', 'tap2', 'videoSha256', 'tap1DeviceAt', 'tap2DeviceAt'});
      expect(body['serial'], serialA);
      expect(body['tap1DeviceAt'], '2026-10-29T20:00:00.000Z');
      final full = pendingSeal(sessionId: 's-1', applied: true).commitBody();
      expect(full['sessionId'], 's-1');
      expect(full['appliedBeforeRecording'], true);
    });

    test('JSON round trip keeps everything', () {
      final s = pendingSeal(sessionId: 's-1', applied: true).copyWith(state: PendingSealState.sealed, sealId: 'seal-9');
      final back = PendingSeal.fromJson(jsonDecode(jsonEncode(s.toJson())) as Map<String, dynamic>);
      expect(back.toJson(), s.toJson());
      expect(back.withoutSession().sessionId, isNull);
      expect(back.withoutSession().state, PendingSealState.sealed);
    });

    test('store saves and loads; an unreadable queue is kept aside, never lost', () async {
      final mem = MemoryStore();
      final store = PendingSealStore(mem);
      expect(await store.load(), isEmpty);
      await store.save([pendingSeal(), pendingSeal(id: 'take2', owner: 'user-2')]);
      expect((await store.load()).map((s) => s.id), ['take1', 'take2']);
      mem.data[PendingSealStore.key] = '{broken';
      expect(await store.load(), isEmpty);
      expect(mem.data['${PendingSealStore.key}.unreadable'], '{broken');
    });
  });

  group('video', () {
    test('sha256 of the file, lowercase hex', () async {
      final dir = await Directory.systemTemp.createTemp('seal');
      final f = File('${dir.path}/v.mp4')..writeAsBytesSync(List.generate(300000, (i) => i % 251));
      expect(await sha256OfFile(f), sha256.convert(f.readAsBytesSync()).toString());
      final kept = await SealVideoStore(root: () async => dir).keep(f.path, 'take1');
      expect(kept.path, endsWith('/seal-videos/take1.mp4'));
      expect(f.existsSync(), isFalse);
      await SealVideoStore.discard(kept.path);
      expect(kept.existsSync(), isFalse);
      await dir.delete(recursive: true);
    });
  });

  group('api', () {
    test('commit sends the step-up header and the body', () async {
      final adapter = FakeAdapter(201, {
        'success': true,
        'data': {'tagId': 't-1', 'sealId': 'seal-1', 'lifecycleStatus': 'ACTIVE', 'ownershipId': 'o', 'videoStatus': 'pending_upload'},
      });
      final done = await sealApiWith(adapter).commit(pendingSeal(), 'grant-1');
      expect(done.sealId, 'seal-1');
      expect(adapter.last!.path, '/nfc/seal');
      expect(adapter.last!.method, 'POST');
      expect(adapter.last!.headers['X-Step-Up'], 'grant-1');
      expect(adapter.last!.data, pendingSeal().commitBody());
    });

    test('session', () async {
      final adapter = FakeAdapter(201, {
        'success': true,
        'data': {'sessionId': 's-1', 'startedAt': '2026-10-29T20:00:00.000Z'},
      });
      final s = await sealApiWith(adapter).startSession(serialA);
      expect(s.id, 's-1');
      expect(adapter.last!.data, {'serial': serialA});
    });
  });

  group('finishing a seal', () {
    Future<CommitResult> run(FakeAdapter adapter, {String? token = 'grant', PendingSeal? seal, Object? confirmError}) =>
        finishSeal(sealApiWith(adapter), seal ?? pendingSeal(), (serial) async {
          expect(serial, serialA);
          if (confirmError != null) throw confirmError;
          return token;
        });

    test('accepted → sealed with the server seal id', () async {
      final r = await run(FakeAdapter(201, {
        'success': true,
        'data': {'tagId': 't-1', 'sealId': 'seal-1'},
      }));
      expect(r.outcome, CommitOutcome.sealed);
      expect(r.updated!.state, PendingSealState.sealed);
      expect(r.updated!.sealId, 'seal-1');
    });

    test('Confirm it’s you closed → nothing sent, confirm again', () async {
      final adapter = FakeAdapter(500, {});
      final r = await run(adapter, token: null);
      expect(r.outcome, CommitOutcome.confirmAgain);
      expect(adapter.last, isNull);
    });

    test('no signal (status or commit) → stays on the phone', () async {
      final r = await run(FakeAdapter(500, {}), confirmError: const ApiException(message: 'offline'));
      expect(r.outcome, CommitOutcome.keepWaiting);
      expect(r.updated, isNull);
      expect((await run(FakeAdapter(503, {}))).outcome, CommitOutcome.keepWaiting);
      expect((await run(FakeAdapter(429, {}))).outcome, CommitOutcome.keepWaiting);
    });

    test('read during the video / taps used / bad MAC → record it again', () async {
      for (final reason in ['seal_gap', 'replay_detected', 'invalid_signature']) {
        final r = await run(FakeAdapter(400, refused(reason)));
        expect(r.outcome, CommitOutcome.redo, reason: reason);
        expect(r.updated, isNull, reason: reason);
      }
    });

    test('claimed, not sealable, not a creator, unknown seal → refused for good', () async {
      for (final reason in ['already_claimed', 'not_sealable', 'creator_only']) {
        final r = await run(FakeAdapter(409, refused(reason)));
        expect(r.outcome, CommitOutcome.refused, reason: reason);
        expect(r.updated!.state, PendingSealState.refused);
        expect(r.updated!.refusedReason, reason);
      }
      final nf = await run(FakeAdapter(404, {'success': false, 'error': 'Not found', 'code': 'not_found'}));
      expect(nf.outcome, CommitOutcome.refused);
      expect(nf.reason, 'not_found');
    });

    test('expired start time → send again without it', () async {
      final r = await run(FakeAdapter(400, refused('tap_session_invalid')), seal: pendingSeal(sessionId: 's-1'));
      expect(r.outcome, CommitOutcome.confirmAgain);
      expect(r.updated!.sessionId, isNull);
    });

    test('step-up refusals are explained, never a redo', () async {
      for (final reason in ['new_method_waiting', 'backup_code_not_allowed', 'recovery_freeze', 'step_up_required']) {
        final r = await run(FakeAdapter(403, refused(reason, code: 'permission_denied')));
        expect(r.outcome, CommitOutcome.confirmAgain, reason: reason);
        expect(r.message, isNotEmpty);
      }
    });
  });
}
