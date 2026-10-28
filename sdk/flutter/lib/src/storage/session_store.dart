import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/models.dart';

/// Minimal key-value storage, so tests can replace the platform keystore.
abstract interface class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Android Keystore / iOS Keychain via flutter_secure_storage.
class SecureKeyValueStore implements KeyValueStore {
  SecureKeyValueStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              // Never restored to another device from a backup
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Storage kept in memory: for tests and throwaway sessions.
class InMemoryKeyValueStore implements KeyValueStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// The persisted part of a session. The access token is never stored.
class StoredSession {
  const StoredSession({
    required this.userId,
    required this.refreshToken,
    required this.refreshTokenExpiresAt,
  });

  factory StoredSession.fromTokens(TokenPair tokens) => StoredSession(
        userId: tokens.userId,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      );

  final String userId;
  final String refreshToken;
  final DateTime refreshTokenExpiresAt;
}

/// What the SDK keeps on the device between launches.
class SessionStore {
  SessionStore(this._store, {String keyPrefix = 'app_platform'})
      : _installationKey = '$keyPrefix.installation_id',
        _sessionKey = '$keyPrefix.session';

  final KeyValueStore _store;
  final String _installationKey;
  final String _sessionKey;

  Future<String?> readInstallationId() => _store.read(_installationKey);

  Future<void> writeInstallationId(String id) => _store.write(_installationKey, id);

  /// Null if there is no session or the stored value is unreadable
  Future<StoredSession?> readSession() async {
    final raw = await _store.read(_sessionKey);
    if (raw == null) return null;

    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, Object?>) return null;
      return StoredSession(
        userId: readString(json, 'userId'),
        refreshToken: readString(json, 'refreshToken'),
        refreshTokenExpiresAt: readDateTime(json, 'refreshTokenExpiresAt'),
      );
    } on FormatException {
      return null;
    }
  }

  /// Stored as one value, so a crash mid-write can never mix
  /// the user id of one session with the token of another
  Future<void> writeSession(StoredSession session) {
    return _store.write(
      _sessionKey,
      jsonEncode({
        'userId': session.userId,
        'refreshToken': session.refreshToken,
        'refreshTokenExpiresAt': session.refreshTokenExpiresAt.toUtc().toIso8601String(),
      }),
    );
  }

  /// Removes the session but keeps the installation id
  Future<void> clearSession() => _store.delete(_sessionKey);
}