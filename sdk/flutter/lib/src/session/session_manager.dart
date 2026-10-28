import 'dart:async';

import 'package:uuid/uuid.dart';

import '../api/models.dart';
import '../api/platform_api.dart';
import '../errors.dart';
import '../storage/session_store.dart';

/// App and device details sent on anonymous sign-up.
class ClientInfo {
  const ClientInfo({
    required this.appId,
    required this.platform,
    required this.appVersion,
    required this.appBuild,
    required this.osVersion,
  });

  final String appId;
  final DevicePlatform platform;
  final String appVersion;
  final String appBuild;
  final String osVersion;
}

enum UserChangeReason {
  /// A new anonymous user was created (first launch, possibly after
  /// a period offline)
  signedUp,

  /// The session was dead; a new anonymous user was created
  sessionReset,

  /// The device was signed into an existing account
  merged,

  /// The user signed out; the device has a new anonymous user
  loggedOut,
}

/// The device now belongs to another user. The app must reload or clear
/// everything tied to the previous user.
class UserChange {
  const UserChange({
    required this.previousUserId,
    required this.userId,
    required this.reason,
  });

  final String? previousUserId;
  final String userId;
  final UserChangeReason reason;

  @override
  String toString() => 'UserChange($reason: $previousUserId -> $userId)';
}

typedef _SignUpResult = ({TokenPair tokens, String installationId});

/// Owns the session: start-up, token renewal, retries and user changes.
/// Every authenticated call to the platform goes through it.
///
/// Works offline: without a connection the app keeps running, with the
/// stored user or with no user yet. The user is created or renewed on
/// the next request once the server is reachable.
class SessionManager {
  SessionManager({
    required this._api,
    required this._store,
    required this._client,
    DateTime Function()? clock,
    String Function()? newInstallationId,
  })  : _clock = clock ?? DateTime.now,
        _newInstallationId = newInstallationId ?? (() => const Uuid().v4());

  /// Renew the access token when it expires within this margin
  static const _refreshMargin = Duration(minutes: 1);
  static const _maxSignUpAttempts = 3;

  final PlatformApi _api;
  final SessionStore _store;
  final ClientInfo _client;
  final DateTime Function() _clock;
  final String Function() _newInstallationId;

  final _changes = StreamController<UserChange>.broadcast();

  String? _installationId;
  StoredSession? _session;
  String? _accessToken;
  DateTime? _accessTokenExpiresAt;

  /// Incremented on every user switch; renewals started earlier are discarded
  int _generation = 0;

  Future<void>? _starting;
  Future<void>? _renewing;
  Future<void>? _applying;

  /// Null until the first successful sign-up (e.g. first launch offline)
  String? get userId => _session?.userId;

  /// Stable id of this installation, available right after start()
  String? get installationId => _installationId;

  Stream<UserChange> get userChanges => _changes.stream;

  /// Loads the stored state and tries to make sure the device has a user.
  /// Never fails because of the network: offline it completes and the user
  /// is created or renewed on the next request. Fails on configuration or
  /// storage errors; the next call then tries again.
  /// Safe to call many times; concurrent calls share one start-up.
  Future<void> start() => _starting ??= _startOnce();

  Future<void> _startOnce() async {
    try {
      var installationId = await _store.readInstallationId();
      if (installationId == null) {
        // Persisted before sign-up: data collected offline is tied to it
        installationId = _newInstallationId();
        await _store.writeInstallationId(installationId);
      }
      _installationId = installationId;
      _session = await _store.readSession();

      try {
        await _renew();
      } on AppPlatformException catch (e) {
        // Offline or server trouble: keep working, retry on the next request
        if (!_isTransient(e)) rethrow;
      }
    } catch (_) {
      _starting = null;
      rethrow;
    }
  }

  /// A valid access token, renewed (or the user created) first if needed.
  /// Throws NetworkException / ServerException while the server is unreachable.
  Future<String> accessToken() async {
    await start();
    if (!_hasFreshAccessToken) await _renew();

    final token = _accessToken;
    if (token == null) throw StateError('No access token after renewal');
    return token;
  }

  /// Runs an authenticated request. On 401 unauthorized renews the session
  /// and retries once; a second 401 is returned to the caller.
  Future<T> authorized<T>(Future<T> Function(String accessToken) send) async {
    final token = await accessToken();
    try {
      return await send(token);
    } on ApiException catch (e) {
      if (e.statusCode != 401 || e.code != ApiErrorCode.unauthorized) rethrow;
      // Force a renewal, unless a parallel request already replaced this token
      if (_accessToken == token) _accessToken = null;
      return send(await accessToken());
    }
  }

  /// Switches to tokens issued by sign-in or logout.
  /// A renewal still in flight for the previous user is discarded.
  Future<void> applyTokens(TokenPair tokens, UserChangeReason reason) async {
    _generation++;
    final applying = _apply(tokens, reason);
    _applying = applying;
    try {
      await applying;
    } finally {
      if (identical(_applying, applying)) _applying = null;
    }
  }

  /// Signs out on this device. The device gets a fresh anonymous user.
  /// Throws ApiException with code no_linked_account for an anonymous
  /// user, who would lose the account: the app should offer linking.
  Future<void> logout() async {
    final tokens = await authorized(_api.logout);
    await applyTokens(tokens, UserChangeReason.loggedOut);
  }

  Future<void> dispose() => _changes.close();

  bool get _hasFreshAccessToken {
    final expiresAt = _accessTokenExpiresAt;
    return _accessToken != null &&
        expiresAt != null &&
        _clock().add(_refreshMargin).isBefore(expiresAt);
  }

  String get _requireInstallationId {
    final id = _installationId;
    if (id == null) throw StateError('Session manager not started');
    return id;
  }

  static bool _isTransient(AppPlatformException e) =>
      e is NetworkException || e is ServerException;

  // Single flight: concurrent callers share one renewal
  Future<void> _renew() {
    return _renewing ??= _renewOnce().whenComplete(() {
      _renewing = null;
    });
  }

  Future<void> _renewOnce() async {
    // A user switch in progress wins; after it the token is fresh
    final applying = _applying;
    if (applying != null) await applying;
    if (_hasFreshAccessToken) return;

    final generation = _generation;
    final session = _session;

    // No user yet: first launch, possibly after a period offline
    if (session == null) {
      final result = await _signUp(_requireInstallationId);
      if (generation == _generation) {
        await _adopt(result, UserChangeReason.signedUp);
      }
      return;
    }

    // Expired on the device: the server would reject it anyway
    if (!_clock().isBefore(session.refreshTokenExpiresAt)) {
      await _resetSession(generation);
      return;
    }

    try {
      final tokens = await _api.refresh(session.refreshToken);
      // Discard if the device switched to another user meanwhile
      if (generation == _generation) await _apply(tokens, null);
    } on ApiException catch (e) {
      if (e.code != ApiErrorCode.invalidRefreshToken) rethrow;
      if (generation == _generation) await _resetSession(generation);
    }
  }

  // The session is dead: replace it with a new anonymous user.
  // Sign-up comes first: if it fails (offline), nothing is changed and the
  // app keeps working with the old user id until the next attempt.
  Future<void> _resetSession(int generation) async {
    final previousUserId = _session?.userId;

    // The old installation id is still registered on the server
    final result = await _signUp(_newInstallationId());
    if (generation != _generation) return;

    await _adopt(result, UserChangeReason.sessionReset, previousUserId: previousUserId);
  }

  // Signs up with the given installation id; on installation_exists
  // retries with new ids. Nothing is persisted here.
  Future<_SignUpResult> _signUp(String installationId) async {
    var candidate = installationId;
    for (var attempt = 1;; attempt++) {
      try {
        final tokens = await _api.signUpAnonymous(
          appId: _client.appId,
          installationId: candidate,
          platform: _client.platform,
          appVersion: _client.appVersion,
          appBuild: _client.appBuild,
          osVersion: _client.osVersion,
        );
        return (tokens: tokens, installationId: candidate);
      } on ApiException catch (e) {
        if (e.code != ApiErrorCode.installationExists || attempt >= _maxSignUpAttempts) {
          rethrow;
        }
        candidate = _newInstallationId();
      }
    }
  }

  // Makes a successful sign-up the current state
  Future<void> _adopt(
    _SignUpResult result,
    UserChangeReason reason, {
    String? previousUserId,
  }) async {
    if (result.installationId != _installationId) {
      await _store.writeInstallationId(result.installationId);
      _installationId = result.installationId;
    }
    await _apply(result.tokens, reason, previousUserId: previousUserId);
  }

  // Persists first, then switches the in-memory state and reports a user change
  Future<void> _apply(
    TokenPair tokens,
    UserChangeReason? reason, {
    String? previousUserId,
  }) async {
    final session = StoredSession.fromTokens(tokens);
    // If the app dies right after this, the rotated token is not lost
    await _store.writeSession(session);

    final previous = previousUserId ?? _session?.userId;
    _session = session;
    _accessToken = tokens.accessToken;
    _accessTokenExpiresAt = _clock().add(tokens.accessTokenExpiresIn);

    if (reason != null && previous != tokens.userId) {
      _changes.add(UserChange(previousUserId: previous, userId: tokens.userId, reason: reason));
    }
  }
}