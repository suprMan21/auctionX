import 'package:authentic_materials/features/seal/data/seal_reader.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('am/seal_reader');
  final calls = <MethodCall>[];

  void answer(Object? Function(MethodCall call) handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return handler(call);
    });
  }

  setUp(calls.clear);
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));

  Uint8List file(String rest) {
    final payload = [0x04, ...rest.codeUnits];
    final record = [0xD1, 0x01, payload.length, 0x55, ...payload];
    return Uint8List.fromList([0, record.length, ...record]);
  }

  test('one read call with the prompt; the file image becomes the URL', () async {
    answer((_) => file('x.test/verify/chip_005?sn=27976EBBCC1B5038'));
    final url = await ApduSealReader().readUrl(prompt: 'Tap the seal');
    expect(url, 'https://x.test/verify/chip_005?sn=27976EBBCC1B5038');
    expect(calls.single.method, 'read');
    expect(calls.single.arguments, {'prompt': 'Tap the seal'});
  });

  test('native errors map to read failures and keep whether the chip was read', () async {
    Future<SealReadException> failWith(String code, bool read) async {
      answer((_) => throw PlatformException(code: code, details: {'chipRead': read}));
      try {
        await ApduSealReader().readUrl(prompt: 'p');
      } on SealReadException catch (e) {
        return e;
      }
      throw StateError('no throw');
    }

    var e = await failWith('cancelled', false);
    expect((e.failure, e.chipRead), (SealReadFailure.cancelled, false));
    e = await failWith('unavailable', false);
    expect(e.failure, SealReadFailure.unavailable);
    e = await failWith('read_failed', true);
    expect((e.failure, e.chipRead), (SealReadFailure.nothingRead, true));
    e = await failWith('not_a_seal', false);
    expect((e.failure, e.chipRead), (SealReadFailure.nothingRead, false));
  });

  test('a file that isn’t a URI record was still read', () async {
    answer((_) => Uint8List.fromList([0, 0]));
    expect(
      () => ApduSealReader().readUrl(prompt: 'p'),
      throwsA(isA<SealReadException>().having((e) => e.chipRead, 'chipRead', isTrue)),
    );
  });
}
