import '../api/models.dart';
import '../api/platform_api.dart';
import '../errors.dart';
import '../session/session_manager.dart';

enum SignInResult {
  /// The account was linked to the current user; the user id did not change
  linked,

  /// The account was already linked to the current user
  alreadyLinked,

  /// The device switched to the existing user who owns this account
  signedIn,

  /// The person cancelled: closed the chooser or the login, or the merge
  cancelled,
}

/// Decides what happens when the account already belongs to another user.
/// Return [MergeStrategy.keepTarget] without asking when this device has no
/// progress worth keeping; return null to cancel.
typedef ResolveMergeConflict = Future<MergeStrategy?> Function();

/// Sends a provider token and handles a merge conflict: shared by Google,
/// Apple and app accounts. [send] gets the access token and the merge
/// strategy (null on the first attempt) and must send the same provider
/// token both times: the refused attempt did not consume the nonce.
Future<SignInResult> completeProviderSignIn(
  SessionManager session, {
  required Future<ProviderSignInResponse> Function(String accessToken, MergeStrategy? strategy) send,
  required ResolveMergeConflict resolveConflict,
}) async {
  ProviderSignInResponse response;
  try {
    response = await session.authorized((accessToken) => send(accessToken, null));
  } on ApiException catch (e) {
    if (e.code != ApiErrorCode.accountExists) rethrow;

    final strategy = await resolveConflict();
    if (strategy == null) return SignInResult.cancelled;

    // The device is about to become another user: send what this one has queued
    await session.prepareUserSwitch();
    response = await session.authorized((accessToken) => send(accessToken, strategy));
  }

  if (response.outcome == ProviderSignInOutcome.signedIn) {
    final tokens = response.tokens;
    if (tokens == null) {
      throw const ServerException(statusCode: 200, message: 'signed_in without tokens');
    }
    await session.applyTokens(tokens, UserChangeReason.merged);
    return SignInResult.signedIn;
  }

  return response.outcome == ProviderSignInOutcome.linked ? SignInResult.linked : SignInResult.alreadyLinked;
}

/// Sign-in with an account of the app's own system (email and password,
/// phone, any provider), confirmed by the app backend with an assertion.
class AccountSignInFlow {
  AccountSignInFlow({required this._session, required this._api});

  final SessionManager _session;
  final PlatformApi _api;

  Future<SignInResult> signIn({
    required Future<String?> Function(String nonce) getAssertion,
    required ResolveMergeConflict resolveConflict,
  }) async {
    // One-time nonce bound to this installation; the backend puts it into the assertion
    final nonce = await _session.authorized(_api.issueNonce);
    final assertion = await getAssertion(nonce.nonce);
    if (assertion == null) return SignInResult.cancelled;

    return completeProviderSignIn(
      _session,
      send: (accessToken, strategy) =>
          _api.signInWithExternal(accessToken, assertion: assertion, mergeStrategy: strategy),
      resolveConflict: resolveConflict,
    );
  }
}