import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import 'support/fake_api.dart';

final _throwsAppDisabled =
    throwsA(isA<ApiException>().having((e) => e.code, 'code', ApiErrorCode.appDisabled));

void main() {
  late DateTime now;
  late FakeApi api;
  late SessionManager session;

  setUp(() {
    now = DateTime.utc(2026, 11, 10, 12);
    api = FakeApi(() => now);
    session = SessionManager(
      api: api,
      store: SessionStore(InMemoryKeyValueStore()),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
  });

  test('start-up does not fail when the app is disabled', () async {
    api.onSignUp = (_) async => throw appDisabled;

    await session.start();

    expect(session.appDisabled.value, isTrue);
    expect(session.userId, isNull);
  });

  test('no requests during the pause, one attempt after it', () async {
    api.onSignUp = (_) async => throw appDisabled;
    await session.start();
    expect(api.signUpInstallationIds, hasLength(1));

    await expectLater(session.accessToken(), _throwsAppDisabled);
    expect(api.signUpInstallationIds, hasLength(1));

    // Enabled again in the admin panel
    api.onSignUp = null;
    now = now.add(SessionManager.disabledRetryAfter);
    await session.accessToken();

    expect(api.signUpInstallationIds, hasLength(2));
    expect(session.userId, 'user-1');
    expect(session.appDisabled.value, isFalse);
  });

  test('the session is kept: no new anonymous user', () async {
    await session.start();
    expect(session.userId, 'user-1');

    // The access token has expired; the refresh is refused
    now = now.add(const Duration(minutes: 20));
    api.onRefresh = (_) async => throw appDisabled;
    await expectLater(session.accessToken(), _throwsAppDisabled);

    expect(session.userId, 'user-1');
    expect(api.signUpInstallationIds, hasLength(1));

    api.onRefresh = null;
    now = now.add(SessionManager.disabledRetryAfter);
    await session.accessToken();

    expect(session.userId, 'user-1');
    expect(session.appDisabled.value, isFalse);
  });

  test('a refused request stops the others without the network', () async {
    await session.start();

    api.billingFailure = appDisabled;
    await expectLater(session.authorized(api.getEntitlements), _throwsAppDisabled);
    expect(api.entitlementRequests, 1);
    expect(session.appDisabled.value, isTrue);

    api.billingFailure = null;
    await expectLater(session.authorized(api.getEntitlements), _throwsAppDisabled);
    expect(api.entitlementRequests, 1);
  });
}