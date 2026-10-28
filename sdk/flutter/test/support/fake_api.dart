import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/api/platform_api.dart';

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
  int _issued = 0;
  int _users = 0;
  int _nonces = 0;

  Future<TokenPair> Function(String installationId)? onSignUp;
  Future<TokenPair> Function(String refreshToken)? onRefresh;
  Future<ProviderSignInResponse> Function(String idToken, MergeStrategy? strategy)?
      onGoogleSignIn;

  TokenPair issue(String userId) {
    _issued++;
    final refreshToken = 'refresh-$_issued';
    _ownerByRefreshToken[refreshToken] = userId;
    return TokenPair(
      userId: userId,
      accessToken: 'access-$_issued',
      accessTokenExpiresIn: const Duration(minutes: 15),
      refreshToken: refreshToken,
      refreshTokenExpiresAt: _now().add(const Duration(days: 90)),
    );
  }

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

  // Not used in these tests; required by the interface
  @override
  Future<PlatformUser> getMe(String accessToken) => throw UnimplementedError();

  Future<TokenPair> Function(String accessToken)? onLogout;

  @override
  Future<TokenPair> logout(String accessToken) async {
    final handler = onLogout;
    if (handler == null) throw StateError('Set onLogout in the test');
    return handler(accessToken);
  }
}