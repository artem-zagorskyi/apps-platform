import '../api/platform_api.dart';
import '../session/session_manager.dart';
import 'google_credentials.dart';
import 'provider_sign_in.dart';

/// Google sign-in: nonce, native chooser, then the shared provider flow.
class GoogleSignInFlow {
  GoogleSignInFlow({
    required this._session,
    required this._api,
    required this._credentials,
    required this._serverClientId,
  });

  final SessionManager _session;
  final PlatformApi _api;
  final GoogleCredentialProvider _credentials;
  final String _serverClientId;

  Future<SignInResult> signIn({required ResolveMergeConflict resolveConflict}) async {
    // Fresh one-time nonce bound to this installation
    final nonce = await _session.authorized(_api.issueNonce);

    final idToken = await _credentials.requestIdToken(
      serverClientId: _serverClientId,
      nonce: nonce.nonce,
    );
    if (idToken == null) return SignInResult.cancelled;

    return completeProviderSignIn(
      _session,
      send: (accessToken, strategy) =>
          _api.signInWithGoogle(accessToken, idToken: idToken, mergeStrategy: strategy),
      resolveConflict: resolveConflict,
    );
  }
}