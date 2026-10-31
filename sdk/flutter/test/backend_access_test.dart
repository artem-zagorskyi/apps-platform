import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import 'support/fake_api.dart';

void main() {
  late DateTime now;
  late FakeApi api;
  late SessionManager session;

  setUp(() async {
    now = DateTime.utc(2026, 10, 31, 12);
    api = FakeApi(() => now);
    session = SessionManager(
      api: api,
      store: SessionStore(InMemoryKeyValueStore()),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
    await session.start();
  });

  group('withAccessToken', () {
    test('passes a valid token', () async {
      final tokens = <String>[];

      final status = await session.withAccessToken(
        (token) async {
          tokens.add(token);
          return 200;
        },
        unauthorized: (status) => status == 401,
      );

      expect(status, 200);
      expect(tokens, hasLength(1));
      expect(api.refreshedTokens, isEmpty);
    });

    test('renews the session once when the backend refuses the token', () async {
      final tokens = <String>[];

      final status = await session.withAccessToken(
        (token) async {
          tokens.add(token);
          return tokens.length == 1 ? 401 : 200;
        },
        unauthorized: (status) => status == 401,
      );

      expect(status, 200);
      expect(tokens.toSet(), hasLength(2));
      expect(api.refreshedTokens, hasLength(1));
    });

    test('returns a second refusal to the caller', () async {
      final status = await session.withAccessToken(
        (_) async => 401,
        unauthorized: (status) => status == 401,
      );

      expect(status, 401);
      expect(api.refreshedTokens, hasLength(1));
    });
  });

  group('before a user switch', () {
    test('runs every hook with the current user, also when one fails', () async {
      api.onLogout = (_) async => api.issue('user-2');
      final calls = <String>[];
      session
        ..addBeforeUserSwitch(() async => calls.add('first:${session.userId}'))
        ..addBeforeUserSwitch(() async => throw StateError('broken'))
        ..addBeforeUserSwitch(() async => calls.add('third:${session.userId}'));

      await session.logout();

      expect(calls, unorderedEquals(['first:user-1', 'third:user-1']));
      expect(session.userId, 'user-2');
    });

    test('a removed hook no longer runs', () async {
      api.onLogout = (_) async => api.issue('user-2');
      var calls = 0;
      final remove = session.addBeforeUserSwitch(() async => calls++);

      remove();
      await session.logout();

      expect(calls, 0);
    });

    test('does not run before an account deletion', () async {
      var calls = 0;
      session.addBeforeUserSwitch(() async => calls++);

      await session.deleteAccount();

      expect(calls, 0);
      expect(session.userId, 'user-2');
    });
  });
}