import 'package:authentic_materials/core/network/api_client.dart';
import 'package:authentic_materials/features/app_update/update_gate.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import '../core/api_client_test.dart' show FakeAdapter;

ApiClient api(FakeAdapter a, ClientInfo c) =>
    ApiClient(baseUrl: 'https://api.example.com/api/v1', client: c, accessToken: () => null, dio: Dio()..httpClientAdapter = a);

const ios010 = ClientInfo(version: '0.1.0', build: '5', platform: 'ios');
const android010 = ClientInfo(version: '0.1.0', build: '5', platform: 'android');

void main() {
  test('parses minimums and https update links, drops the rest', () {
    final c = ServerAppConfig.fromJson({
      'minVersion': {'ios': '0.2.0', 'android': 'nonsense'},
      'updateUrl': {'ios': 'https://testflight.apple.com/join/x', 'android': 'http://insecure'},
    });
    expect(c.minIos.toString(), '0.2.0');
    expect(c.minAndroid, isNull);
    expect(c.updateUrlIos.toString(), 'https://testflight.apple.com/join/x');
    expect(c.updateUrlAndroid, isNull);
    expect(ServerAppConfig.fromJson({}).minIos, isNull);
  });

  test('below the minimum only on its own platform', () {
    final c = ServerAppConfig.fromJson({'minVersion': {'ios': '0.2.0', 'android': '0.1.0'}});
    expect(isBelowMinimum(c, ios010), isTrue);
    expect(isBelowMinimum(c, android010), isFalse);
  });

  test('check: required with the store link', () async {
    final a = FakeAdapter(200, {
      'success': true,
      'data': {'minVersion': {'ios': '1.0.0', 'android': '0.0.0'}, 'updateUrl': {'ios': 'https://apps.apple.com/app/id1'}},
    });
    final s = await checkForUpdate(api(a, ios010), ios010);
    expect(s, isA<UpdateRequired>());
    expect((s as UpdateRequired).updateUrl.toString(), 'https://apps.apple.com/app/id1');
    expect(a.last!.path, '/app-config');
  });

  test('check: ok when current, and ok when the server is unreachable or old', () async {
    final ok = FakeAdapter(200, {'success': true, 'data': {'minVersion': {'ios': '0.1.0'}}});
    expect(await checkForUpdate(api(ok, ios010), ios010), isA<UpdateOk>());
    final down = FakeAdapter(503, {'success': false});
    expect(await checkForUpdate(api(down, ios010), ios010), isA<UpdateOk>());
    final missing = FakeAdapter(404, {'error': 'Not found'});
    expect(await checkForUpdate(api(missing, ios010), ios010), isA<UpdateOk>());
  });

  test('check: a 426 from the server means update', () async {
    final a = FakeAdapter(426, {'success': false, 'reason': 'app_update_required'});
    expect(await checkForUpdate(api(a, ios010), ios010), isA<UpdateRequired>());
  });
}
