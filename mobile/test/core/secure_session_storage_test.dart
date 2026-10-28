import 'dart:io';

import 'package:authentic_materials/core/storage/secure_session_storage.dart';
import 'package:flutter_test/flutter_test.dart';

class MemoryStore implements KeyValueStore {
  final Map<String, String> data = {};
  int deleteAllCalls = 0;

  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async {
    deleteAllCalls++;
    data.clear();
  }
}

void main() {
  test('session round-trips through the store', () async {
    final store = MemoryStore();
    final s = SecureSessionStorage(store);
    await s.initialize();
    expect(await s.hasAccessToken(), isFalse);
    await s.persistSession('{"access_token":"a","refresh_token":"r"}');
    expect(await s.hasAccessToken(), isTrue);
    expect(await s.accessToken(), contains('refresh_token'));
    await s.removePersistedSession();
    expect(await s.hasAccessToken(), isFalse);
  });

  test('PKCE items are namespaced and removable', () async {
    final store = MemoryStore();
    final p = SecurePkceStorage(store);
    await p.setItem(key: 'verifier', value: 'v');
    expect(store.data.keys, ['am.pkce.verifier']);
    expect(await p.getItem(key: 'verifier'), 'v');
    await p.removeItem(key: 'verifier');
    expect(store.data, isEmpty);
  });

  test('first launch clears leftover keychain items once', () async {
    final dir = await Directory.systemTemp.createTemp('am_first_launch');
    addTearDown(() => dir.delete(recursive: true));
    final store = MemoryStore()..data['am.session'] = 'left over from a deleted install';
    final cleanup = FirstLaunchCleanup(store, supportDir: () async => dir);

    expect(await cleanup.run(), isTrue);
    expect(store.data, isEmpty);

    store.data['am.session'] = 'signed in since';
    expect(await cleanup.run(), isFalse);
    expect(store.data['am.session'], 'signed in since');
    expect(store.deleteAllCalls, 1);
  });
}
