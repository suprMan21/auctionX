import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Minimal key-value store, so the session code can be tested without the
/// platform keychain.
abstract class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
  Future<void> deleteAll();
}

/// The keychain (iOS) / Keystore-backed storage (Android).
///
/// iOS: `first_unlock_this_device`, so the item never moves to another device
/// through a backup and is readable after the first unlock (background refresh).
/// Android: backups are switched off for the app (AndroidManifest), because a
/// restored item cannot be decrypted on a new phone.
class PlatformSecureStore implements KeyValueStore {
  PlatformSecureStore()
      : _storage = const FlutterSecureStorage(
          iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
          aOptions: AndroidOptions(),
        );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);

  @override
  Future<void> deleteAll() => _storage.deleteAll();
}

/// Keeps the Supabase session (including the refresh token) in secure storage
/// instead of supabase_flutter's default SharedPreferences, which is plain text.
class SecureSessionStorage extends LocalStorage {
  SecureSessionStorage(this._store, {this.key = 'am.session'});

  final KeyValueStore _store;
  final String key;

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() async => (await _store.read(key)) != null;

  @override
  Future<String?> accessToken() => _store.read(key);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _store.write(key, persistSessionString);

  @override
  Future<void> removePersistedSession() => _store.delete(key);
}

/// The PKCE code verifier store, also kept out of SharedPreferences.
class SecurePkceStorage extends GotrueAsyncStorage {
  SecurePkceStorage(this._store);

  final KeyValueStore _store;
  static const _prefix = 'am.pkce.';

  @override
  Future<String?> getItem({required String key}) => _store.read('$_prefix$key');

  @override
  Future<void> setItem({required String key, required String value}) =>
      _store.write('$_prefix$key', value);

  @override
  Future<void> removeItem({required String key}) => _store.delete('$_prefix$key');
}

/// iOS keeps keychain items after the app is deleted, so a reinstall would
/// otherwise sign straight back in to the last account. The app's own files
/// are deleted with the app, so a marker file tells us this is a fresh install.
class FirstLaunchCleanup {
  FirstLaunchCleanup(this._store, {Future<Directory> Function()? supportDir})
      : _supportDir = supportDir ?? getApplicationSupportDirectory;

  final KeyValueStore _store;
  final Future<Directory> Function() _supportDir;
  static const markerName = '.am_installed';

  /// Returns true when this was the first launch (and storage was cleared).
  Future<bool> run() async {
    final dir = await _supportDir();
    final marker = File('${dir.path}/$markerName');
    if (await marker.exists()) return false;
    await _store.deleteAll();
    await dir.create(recursive: true);
    await marker.writeAsString(DateTime.now().toUtc().toIso8601String());
    return true;
  }
}
