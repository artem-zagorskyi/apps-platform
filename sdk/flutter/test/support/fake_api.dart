import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/api/platform_api.dart';
import 'package:renvix_sdk/src/events/event_queue.dart';

const testClient = ClientInfo(
  appId: 'app-1',
  platform: DevicePlatform.android,
  appVersion: '1.0.0',
  appBuild: '1',
  osVersion: '17',
);

const deadRefreshToken = ApiException(
  statusCode: 401,
  code: ApiErrorCode.invalidRefreshToken,
  message: 'Refresh token is invalid or expired',
);

/// In-memory stand-in for the platform server.
/// Issues numbered tokens and nonces; handlers override responses per test.
class FakeApi implements PlatformApi {
  FakeApi(this._now);

  final DateTime Function() _now;
  final signUpInstallationIds = <String>[];
  final refreshedTokens = <String>[];
  final googleSignIns = <({String idToken, MergeStrategy? strategy})>[];
  final _ownerByRefreshToken = <String, String>{};
  final _ownerByAccessToken = <String, String>{};
  int _issued = 0;
  int _users = 0;
  int _nonces = 0;

  Future<TokenPair> Function(String installationId)? onSignUp;
  Future<TokenPair> Function(String refreshToken)? onRefresh;
  Future<ProviderSignInResponse> Function(String idToken, MergeStrategy? strategy)?
      onGoogleSignIn;
  Future<TokenPair> Function(String accessToken)? onLogout;

  // Consent server: one policy, decisions per user
  ConsentMode consentMode = ConsentMode.optional;
  String consentPolicyVersion = 'v1';
  AppPlatformException? consentFailure;
  final consentRecords = <({
    String userId,
    Map<ConsentPurpose, bool> decisions,
    String policyVersion,
    ConsentSource source,
  })>[];
  final _consentByUser = <String, Map<ConsentPurpose, ConsentDecision>>{};

  TokenPair issue(String userId) {
    _issued++;
    final accessToken = 'access-$_issued';
    final refreshToken = 'refresh-$_issued';
    _ownerByAccessToken[accessToken] = userId;
    _ownerByRefreshToken[refreshToken] = userId;
    return TokenPair(
      userId: userId,
      accessToken: accessToken,
      accessTokenExpiresIn: const Duration(minutes: 15),
      refreshToken: refreshToken,
      refreshTokenExpiresAt: _now().add(const Duration(days: 90)),
    );
  }

  /// Decisions the server already has for a user (e.g. from another device)
  void setServerConsent(String userId, Map<ConsentPurpose, bool> decisions) {
    _consentByUser[userId] = {
      for (final entry in decisions.entries)
        entry.key: ConsentDecision(
          granted: entry.value,
          policyVersion: consentPolicyVersion,
          decidedAt: _now(),
        ),
    };
  }

  String _userOf(String accessToken) =>
      _ownerByAccessToken[accessToken] ?? (throw StateError('Unknown access token $accessToken'));

  ServerConsentState _consentState(String userId) => ServerConsentState(
        mode: consentMode,
        policyVersion: consentPolicyVersion,
        decisions: Map.of(_consentByUser[userId] ?? const {}),
        canAskAgainAt: null,
      );

  @override
  Duration get timeout => const Duration(seconds: 1);

  @override
  Future<TokenPair> signUpAnonymous({
    required String appId,
    required String installationId,
    required DevicePlatform platform,
    required String appVersion,
    required String appBuild,
    required String osVersion,
  }) async {
    signUpInstallationIds.add(installationId);
    final handler = onSignUp;
    if (handler != null) return handler(installationId);
    _users++;
    return issue('user-$_users');
  }

  @override
  Future<TokenPair> refresh(String refreshToken) async {
    refreshedTokens.add(refreshToken);
    final handler = onRefresh;
    if (handler != null) return handler(refreshToken);
    final owner = _ownerByRefreshToken[refreshToken];
    if (owner == null) throw deadRefreshToken;
    return issue(owner);
  }

  @override
  Future<SignInNonce> issueNonce(String accessToken) async {
    _nonces++;
    return SignInNonce(
      nonce: 'nonce-$_nonces',
      expiresAt: _now().add(const Duration(minutes: 10)),
    );
  }

  @override
  Future<ProviderSignInResponse> signInWithGoogle(
    String accessToken, {
    required String idToken,
    MergeStrategy? mergeStrategy,
  }) async {
    googleSignIns.add((idToken: idToken, strategy: mergeStrategy));
    final handler = onGoogleSignIn;
    if (handler == null) throw StateError('Set onGoogleSignIn in the test');
    return handler(idToken, mergeStrategy);
  }

  @override
  Future<TokenPair> logout(String accessToken) async {
    final handler = onLogout;
    if (handler == null) throw StateError('Set onLogout in the test');
    return handler(accessToken);
  }

  @override
  Future<ServerConsentState> getConsent(String accessToken) async {
    final failure = consentFailure;
    if (failure != null) throw failure;
    return _consentState(_userOf(accessToken));
  }

  @override
  Future<ServerConsentState> recordConsent(
    String accessToken, {
    required Map<ConsentPurpose, bool> decisions,
    required String policyVersion,
    required ConsentSource source,
    required DateTime decidedAt,
    required DateTime sentAt,
  }) async {
    final failure = consentFailure;
    if (failure != null) throw failure;

    final userId = _userOf(accessToken);
    consentRecords.add((
      userId: userId,
      decisions: decisions,
      policyVersion: policyVersion,
      source: source,
    ));

    final stored = _consentByUser.putIfAbsent(userId, () => {});
    for (final entry in decisions.entries) {
      stored[entry.key] = ConsentDecision(
        granted: entry.value,
        policyVersion: policyVersion,
        decidedAt: decidedAt,
      );
    }
    return _consentState(userId);
  }

  // Events server: accepts everything unless a test says otherwise
  final eventBatches = <({String userId, List<QueuedEvent> events})>[];
  AppPlatformException? eventsFailure;
  Future<EventBatchResult> Function(List<QueuedEvent> events)? onSendEvents;

  @override
  Future<EventBatchResult> sendEvents(
    String accessToken, {
    required DateTime sentAt,
    required List<QueuedEvent> events,
  }) async {
    final failure = eventsFailure;
    if (failure != null) throw failure;

    eventBatches.add((userId: _userOf(accessToken), events: events));
    final handler = onSendEvents;
    if (handler != null) return handler(events);
    return EventBatchResult(accepted: [for (final e in events) e.eventId], rejected: const []);
  }

  // Not used in these tests; required by the interface
  @override
  Future<PlatformUser> getMe(String accessToken) => throw UnimplementedError();

  // Config server: one config per user; the ETag is "<user>:<version>"
  final configRequests = <({String userId, String appVersion, String? etag})>[];
  final _configByUser = <String, ServerConfig>{};
  AppPlatformException? configFailure;

  /// Runs before the answer, e.g. to hold it until the test continues
  Future<void> Function()? onGetConfig;

  final deletedUsers = <String>[];
  Future<TokenPair> Function(String accessToken)? onDeleteAccount;

  @override
  Future<TokenPair> deleteAccount(String accessToken) async {
    final handler = onDeleteAccount;
    if (handler != null) return handler(accessToken);
    deletedUsers.add(_userOf(accessToken));
    _users++;
    return issue('user-$_users');
  }

  void setServerConfig(String userId, ServerConfig config) => _configByUser[userId] = config;

  @override
  Future<ConfigResponse?> getConfig(
    String accessToken, {
    required String appVersion,
    String? etag,
  }) async {
    final userId = _userOf(accessToken);
    configRequests.add((userId: userId, appVersion: appVersion, etag: etag));
    await onGetConfig?.call();

    final failure = configFailure;
    if (failure != null) throw failure;

    final config = _configByUser[userId] ?? const ServerConfig(version: 0, values: {}, experiments: []);
    final tag = '"$userId:${config.version}"';
    if (etag == tag) return null;
    return ConfigResponse(config: config, etag: tag);
  }
}