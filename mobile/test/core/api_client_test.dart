import 'dart:convert';
import 'dart:typed_data';

import 'package:authentic_materials/core/network/api_client.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// Answers every request with a fixed status + JSON body and records the request.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.status, this.body, {this.headers = const {}});
  final int status;
  final Object? body;
  final Map<String, List<String>> headers;
  RequestOptions? last;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    last = options;
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: ['application/json'],
      ...headers,
    });
  }

  @override
  void close({bool force = false}) {}
}

const client = ClientInfo(version: '0.1.0', build: '5', platform: 'ios');

ApiClient make(FakeAdapter adapter, {String? token, void Function()? onUpdate}) {
  final dio = Dio()..httpClientAdapter = adapter;
  return ApiClient(
    baseUrl: 'https://api.example.com/api/v1',
    client: client,
    accessToken: () => token,
    onUpdateRequired: onUpdate,
    dio: dio,
  );
}

void main() {
  test('sends the app identity headers and the bearer token', () async {
    final adapter = FakeAdapter(200, {'success': true, 'data': {'ok': true}});
    final data = await make(adapter, token: 'tok').get('/x');
    expect(data, {'ok': true});
    final h = adapter.last!.headers;
    expect(h['X-App-Version'], '0.1.0');
    expect(h['X-App-Platform'], 'ios');
    expect(h['User-Agent'], 'AuthenticMaterials/0.1.0 (5; iOS)');
    expect(h['Authorization'], 'Bearer tok');
  });

  test('no token, no Authorization header', () async {
    final adapter = FakeAdapter(200, {'success': true, 'data': <String, dynamic>{}});
    await make(adapter).get('/x');
    expect(adapter.last!.headers.containsKey('Authorization'), isFalse);
  });

  test('keeps the server reason (top level or in details) and the 4xx message', () async {
    final a = FakeAdapter(403, {'success': false, 'error': 'Confirm it is you', 'reason': 'step_up_required'});
    await expectLater(
      make(a).post('/x'),
      throwsA(isA<ApiException>()
          .having((e) => e.status, 'status', 403)
          .having((e) => e.reason, 'reason', 'step_up_required')
          .having((e) => e.message, 'message', 'Confirm it is you')),
    );
    final b = FakeAdapter(409, {'success': false, 'error': 'x', 'details': {'reason': 'new_method_waiting'}});
    await expectLater(make(b).post('/x'), throwsA(isA<ApiException>().having((e) => e.reason, 'reason', 'new_method_waiting')));
  });

  test('a 5xx never shows server text', () async {
    final a = FakeAdapter(500, {'success': false, 'error': 'TypeError: x is undefined at handler.ts:12'});
    await expectLater(
      make(a).get('/x'),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', isNot(contains('TypeError')))),
    );
  });

  test('app_update_required calls the update hook', () async {
    var called = 0;
    final a = FakeAdapter(426, {'success': false, 'error': 'Update', 'reason': 'app_update_required'});
    await expectLater(make(a, onUpdate: () => called++).get('/x'), throwsA(isA<ApiException>().having((e) => e.updateRequired, 'update', true)));
    expect(called, 1);
  });

  test('reads Retry-After', () async {
    final a = FakeAdapter(429, {'success': false, 'error': 'Slow down'}, headers: {'retry-after': ['30']});
    await expectLater(make(a).post('/x'), throwsA(isA<ApiException>().having((e) => e.retryAfter, 'retry', const Duration(seconds: 30))));
  });

  test('unwrap refuses anything but a success envelope', () {
    expect(ApiClient.unwrap({'success': true, 'data': {'a': 1}}), {'a': 1});
    expect(ApiClient.unwrap({'success': true}), isEmpty);
    expect(() => ApiClient.unwrap({'success': false}), throwsA(isA<ApiException>()));
    expect(() => ApiClient.unwrap('<html>'), throwsA(isA<ApiException>()));
    expect(() => ApiClient.unwrap({'success': true, 'data': [1]}), throwsA(isA<ApiException>()));
  });
}
