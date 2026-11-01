import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/auth/provider_sign_in.dart';
import 'package:renvix_sdk/src/errors.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import 'support/fake_api.dart';

const _accountExists = ApiException(statusCode: 409, code: ApiErrorCode.accountExists, message: 'Account exists');

Future<MergeStrategy?> _mustNotAsk() => throw StateError('The merge dialog must not open');

void main() {
  late DateTime now;
  late FakeApi api;
  late SessionManager session;
  late AccountSignInFlow flow;

  setUp(() async {
    now = DateTime.utc(2026, 11, 1, 12);
    api = FakeApi(() => now);
    session = SessionManager(
      api: api,
      store: SessionStore(InMemoryKeyValueStore()),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
    await session.start();
    flow = AccountSignInFlow(session: session, api: api);
  });

  ProviderSignInResponse linked() =>
      const ProviderSignInResponse(outcome: ProviderSignInOutcome.linked, userId: 'user-1', tokens: null);

  test('passes the platform nonce to the app and its assertion to the platform', () async {
    final nonces = <String>[];
    api.onExternalSignIn = (_, _) async => linked();

    final result = await flow.signIn(
      getAssertion: (nonce) async {
        nonces.add(nonce);
        return 'assertion-$nonce';
      },
      resolveConflict: _mustNotAsk,
    );

    expect(result, SignInResult.linked);
    expect(nonces, ['nonce-1']);
    expect(api.externalSignIns.single.assertion, 'assertion-nonce-1');
    expect(api.externalSignIns.single.strategy, isNull);
    expect(session.userId, 'user-1');
  });

  test('is cancelled when the app returns no assertion', () async {
    final result = await flow.signIn(getAssertion: (_) async => null, resolveConflict: _mustNotAsk);

    expect(result, SignInResult.cancelled);
    expect(api.externalSignIns, isEmpty);
  });

  test('merges into the existing account with the same assertion', () async {
    api.onExternalSignIn = (_, strategy) async {
      if (strategy == null) throw _accountExists;
      return ProviderSignInResponse(
        outcome: ProviderSignInOutcome.signedIn,
        userId: 'user-9',
        tokens: api.issue('user-9'),
      );
    };
    final switching = <String?>[];
    session.addBeforeUserSwitch(() async => switching.add(session.userId));
    final changes = <UserChange>[];
    final subscription = session.userChanges.listen(changes.add);

    final result = await flow.signIn(
      getAssertion: (nonce) async => 'assertion-$nonce',
      resolveConflict: () async => MergeStrategy.keepTarget,
    );
    await Future<void>.delayed(Duration.zero);

    expect(result, SignInResult.signedIn);
    expect(session.userId, 'user-9');
    expect(
      [for (final s in api.externalSignIns) (s.assertion, s.strategy)],
      [('assertion-nonce-1', null), ('assertion-nonce-1', MergeStrategy.keepTarget)],
    );
    // The previous user could send what it had queued before the switch
    expect(switching, ['user-1']);
    expect(changes.single.reason, UserChangeReason.merged);
    await subscription.cancel();
  });

  test('a cancelled merge changes nothing', () async {
    api.onExternalSignIn = (_, _) async => throw _accountExists;

    final result = await flow.signIn(
      getAssertion: (nonce) async => 'assertion-$nonce',
      resolveConflict: () async => null,
    );

    expect(result, SignInResult.cancelled);
    expect(api.externalSignIns, hasLength(1));
    expect(session.userId, 'user-1');
  });
}