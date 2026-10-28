import '../api/models.dart';
import '../api/platform_api.dart';
import '../errors.dart';
import '../session/session_manager.dart';
import 'google_credentials.dart';

enum GoogleSignInResult {
  /// The Google account was linked to the current user; the user id did not change
  linked,

  /// The account was already linked to the current user
  alreadyLinked,

  /// The device switched to the existing user who owns this account
  signedIn,

  /// The person closed the Google chooser or cancelled the merge
  cancelled,
}

/// Decides what happens when the Google account already belongs to
/// another user. Return [MergeStrategy.keepTarget] without asking when
/// this device has no progress worth keeping; return null to cancel.
typedef ResolveMergeConflict = Future<MergeStrategy?> Function();

/// Google sign-in: nonce, native chooser, server call, merge conflict.
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

  Future<GoogleSignInResult> signIn({
    required ResolveMergeConflict resolveConflict,
  }) async {
    // Fresh one-time nonce bound to this installation
    final nonce = await _session.authorized(_api.issueNonce);

    final idToken = await _credentials.requestIdToken(
      serverClientId: _serverClientId,
      nonce: nonce.nonce,
    );
    if (idToken == null) return GoogleSignInResult.cancelled;

    ProviderSignInResponse response;
    try {
      response = await _send(idToken, null);
    } on ApiException catch (e) {
      if (e.code != ApiErrorCode.accountExists) rethrow;

      final strategy = await resolveConflict();
      if (strategy == null) return GoogleSignInResult.cancelled;

      // Same token: the refused attempt did not consume the nonce
      response = await _send(idToken, strategy);
    }

    if (response.outcome == ProviderSignInOutcome.signedIn) {
      final tokens = response.tokens;
      if (tokens == null) {
        throw const ServerException(statusCode: 200, message: 'signed_in without tokens');
      }
      await _session.applyTokens(tokens, UserChangeReason.merged);
      return GoogleSignInResult.signedIn;
    }

    return response.outcome == ProviderSignInOutcome.linked
        ? GoogleSignInResult.linked
        : GoogleSignInResult.alreadyLinked;
  }

  Future<ProviderSignInResponse> _send(String idToken, MergeStrategy? strategy) {
    return _session.authorized(
      (accessToken) => _api.signInWithGoogle(
        accessToken,
        idToken: idToken,
        mergeStrategy: strategy,
      ),
    );
  }
}