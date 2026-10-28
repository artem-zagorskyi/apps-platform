import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/auth/google_credentials.dart';
import 'package:renvix_sdk/src/auth/google_sign_in_flow.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import 'support/fake_api.dart';

/// Stands in for the native Google chooser
class FakeGoogleCredentials implements GoogleCredentialProvider {
  final requestedNonces = <String>[];
  bool cancel = false;
  AppPlatformException? failure;

  @override
  Future<String?> requestIdToken({
    required String serverClientId,
    required String nonce,
  }) async {
    requestedNonces.add(nonce);
    final error = failure;
    if (error != null) throw error;
    return cancel ? null : 'google-token-$nonce';
  }
}

const _accountExists = ApiException(
  statusCode: 409,
  code: ApiErrorCode.accountExists,
  message: 'This account already exists',
);

ProviderSignInResponse _linked(String userId) =>
    ProviderSignInResponse(outcome: ProviderSignInOutcome.linked, userId: userId, tokens: null);

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late FakeApi api;
  late FakeGoogleCredentials google;
  late SessionManager session;
  late GoogleSignInFlow flow;
  late List<UserChange> changes;

  setUp(() async {
    final now = DateTime.utc(2026, 10, 28, 12);
    api = FakeApi(() => now);
    google = FakeGoogleCredentials();
    changes = [];
    session = SessionManager(
      api: api,
      store: SessionStore(InMemoryKeyValueStore()),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
    await session.start();
    session.userChanges.listen(changes.add);
    flow = GoogleSignInFlow(
      session: session,
      api: api,
      credentials: google,
      serverClientId: 'web-client-id',
    );
  });

  Future<MergeStrategy?> mustNotAsk() async => fail('resolveConflict must not be called');

  test('links the account and keeps the user', () async {
    api.onGoogleSignIn = (_, _) async => _linked('user-1');

    final result = await flow.signIn(resolveConflict: mustNotAsk);

    expect(result, GoogleSignInResult.linked);
    // The server nonce went into the chooser, its token went to the server
    expect(google.requestedNonces, ['nonce-1']);
    expect(api.googleSignIns.single.idToken, 'google-token-nonce-1');
    expect(api.googleSignIns.single.strategy, isNull);
    expect(session.userId, 'user-1');
  });

  test('returns cancelled when the chooser is closed', () async {
    google.cancel = true;

    final result = await flow.signIn(resolveConflict: mustNotAsk);

    expect(result, GoogleSignInResult.cancelled);
    expect(api.googleSignIns, isEmpty);
  });

  test('merges into the existing account with the chosen strategy', () async {
    api.onGoogleSignIn = (_, strategy) async {
      if (strategy == null) throw _accountExists;
      return ProviderSignInResponse(
        outcome: ProviderSignInOutcome.signedIn,
        userId: 'user-9',
        tokens: api.issue('user-9'),
      );
    };
    var asked = 0;

    final result = await flow.signIn(resolveConflict: () async {
      asked++;
      return MergeStrategy.keepSource;
    });
    await _flush();

    expect(result, GoogleSignInResult.signedIn);
    expect(asked, 1);
    // The retry reuses the same Google token
    expect(api.googleSignIns.map((call) => call.idToken), everyElement('google-token-nonce-1'));
    expect(api.googleSignIns.last.strategy, MergeStrategy.keepSource);
    expect(session.userId, 'user-9');
    expect(changes.single.reason, UserChangeReason.merged);
  });

  test('cancelling the merge changes nothing', () async {
    api.onGoogleSignIn = (_, _) async => throw _accountExists;

    final result = await flow.signIn(resolveConflict: () async => null);

    expect(result, GoogleSignInResult.cancelled);
    expect(api.googleSignIns, hasLength(1));
    expect(session.userId, 'user-1');
  });

  test('passes server refusals to the app', () async {
    api.onGoogleSignIn = (_, _) async => throw const ApiException(
          statusCode: 409,
          code: ApiErrorCode.alreadySignedIn,
          message: 'Sign out first',
        );

    await expectLater(
      flow.signIn(resolveConflict: mustNotAsk),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', ApiErrorCode.alreadySignedIn)),
    );
  });

  test('passes native chooser failures to the app', () async {
    google.failure = const ProviderSignInException(
      code: 'no_google_account',
      message: 'No Google account on this device',
    );

    await expectLater(
      flow.signIn(resolveConflict: mustNotAsk),
      throwsA(isA<ProviderSignInException>()),
    );
  });
}