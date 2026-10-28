import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import 'support/fake_api.dart';

const _offline = NetworkException('offline');

const _unauthorized = ApiException(
  statusCode: 401,
  code: ApiErrorCode.unauthorized,
  message: 'Access token is invalid or expired',
);

// Lets broadcast stream events reach their listeners
Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late DateTime now;
  late FakeApi api;
  late SessionStore store;
  late List<UserChange> changes;
  late int installationCounter;

  setUp(() {
    now = DateTime.utc(2026, 10, 28, 12);
    api = FakeApi(() => now);
    store = SessionStore(InMemoryKeyValueStore());
    changes = [];
    installationCounter = 0;
  });

  SessionManager createManager() {
    final manager = SessionManager(
      api: api,
      store: store,
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-${++installationCounter}',
    );
    manager.userChanges.listen(changes.add);
    return manager;
  }

  // A device that already has a session from an earlier launch
  Future<TokenPair> storePreviousSession({DateTime? expiresAt}) async {
    final tokens = api.issue('user-7');
    await store.writeInstallationId('install-old');
    await store.writeSession(StoredSession(
      userId: tokens.userId,
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: expiresAt ?? tokens.refreshTokenExpiresAt,
    ));
    return tokens;
  }

  group('start', () {
    test('first launch creates an installation and an anonymous user', () async {
      final manager = createManager();

      await manager.start();
      await _flush();

      expect(manager.installationId, 'install-1');
      expect(manager.userId, 'user-1');
      expect(await store.readInstallationId(), 'install-1');
      expect((await store.readSession())?.userId, 'user-1');
      expect(api.signUpInstallationIds, ['install-1']);
      expect(changes.single.reason, UserChangeReason.signedUp);
      expect(await manager.accessToken(), 'access-1');
    });

    test('resumes a stored session by refreshing it', () async {
      final previous = await storePreviousSession();
      final manager = createManager();

      await manager.start();
      await _flush();

      expect(manager.userId, 'user-7');
      expect(manager.installationId, 'install-old');
      expect(api.signUpInstallationIds, isEmpty);
      expect(api.refreshedTokens, [previous.refreshToken]);
      // The rotated token is persisted
      expect((await store.readSession())?.refreshToken, isNot(previous.refreshToken));
      expect(changes, isEmpty);
    });

    test('works offline with a stored session and renews later', () async {
      await storePreviousSession();
      api.onRefresh = (_) async => throw _offline;
      final manager = createManager();

      await manager.start();
      expect(manager.userId, 'user-7');

      api.onRefresh = null;
      expect(await manager.accessToken(), startsWith('access-'));
    });

    test('starts offline without a user and creates it once online', () async {
      api.onSignUp = (_) async => throw _offline;
      final manager = createManager();

      await manager.start();

      // No user yet, but a stable installation id for data collected offline
      expect(manager.userId, isNull);
      expect(await store.readInstallationId(), 'install-1');
      await expectLater(manager.accessToken(), throwsA(isA<NetworkException>()));

      api.onSignUp = null;
      expect(await manager.accessToken(), startsWith('access-'));
      await _flush();

      expect(manager.userId, 'user-1');
      expect(manager.installationId, 'install-1');
      expect(changes.single.reason, UserChangeReason.signedUp);
    });

    test('retries sign-up with a new installation id when the id is taken', () async {
      api.onSignUp = (_) async {
        if (api.signUpInstallationIds.length == 1) {
          throw const ApiException(
            statusCode: 409,
            code: ApiErrorCode.installationExists,
            message: 'Installation id is already registered',
          );
        }
        return api.issue('user-1');
      };
      final manager = createManager();

      await manager.start();

      expect(api.signUpInstallationIds, ['install-1', 'install-2']);
      expect(manager.installationId, 'install-2');
      expect(await store.readInstallationId(), 'install-2');
    });

    test('fails on a configuration error', () async {
      api.onSignUp = (_) async => throw const ApiException(
            statusCode: 400,
            code: ApiErrorCode.unknownApp,
            message: 'App is unknown',
          );
      final manager = createManager();

      await expectLater(manager.start(), throwsA(isA<ApiException>()));
    });
  });

  group('dead session', () {
    test('a rejected refresh token resets to a new anonymous user', () async {
      await storePreviousSession();
      api.onRefresh = (_) async => throw deadRefreshToken;
      final manager = createManager();

      await manager.start();
      await _flush();

      // The old installation id stays registered on the server: a new one is used
      expect(manager.installationId, 'install-1');
      expect(await store.readInstallationId(), 'install-1');
      expect(manager.userId, 'user-1');
      expect(
        changes.single,
        isA<UserChange>()
            .having((c) => c.reason, 'reason', UserChangeReason.sessionReset)
            .having((c) => c.previousUserId, 'previousUserId', 'user-7'),
      );
    });

    test('a refresh token expired on the device resets without asking the server', () async {
      await storePreviousSession(expiresAt: now.subtract(const Duration(days: 1)));
      final manager = createManager();

      await manager.start();
      await _flush();

      expect(api.refreshedTokens, isEmpty);
      expect(changes.single.reason, UserChangeReason.sessionReset);
    });

    test('offline, a dead session is kept until a new user can be created', () async {
      await storePreviousSession();
      api.onRefresh = (_) async => throw deadRefreshToken;
      api.onSignUp = (_) async => throw _offline;
      final manager = createManager();

      await manager.start();

      // Nothing replaced: the app keeps working with the old user
      expect(manager.userId, 'user-7');
      expect(manager.installationId, 'install-old');
      expect((await store.readSession())?.userId, 'user-7');
      expect(await store.readInstallationId(), 'install-old');

      api.onSignUp = null;
      await manager.accessToken();
      await _flush();

      expect(manager.userId, isNot('user-7'));
      expect(manager.installationId, isNot('install-old'));
      expect(changes.single.reason, UserChangeReason.sessionReset);
      expect(changes.single.previousUserId, 'user-7');
    });

    test('a network error never clears the session', () async {
      final manager = createManager();
      await manager.start();
      now = now.add(const Duration(minutes: 15));
      api.onRefresh = (_) async => throw _offline;

      await expectLater(manager.accessToken(), throwsA(isA<NetworkException>()));

      expect(manager.userId, 'user-1');
      expect(await store.readSession(), isNotNull);
    });
  });

  group('renewal', () {
    test('renews shortly before the access token expires', () async {
      final manager = createManager();
      await manager.start();

      now = now.add(const Duration(minutes: 10));
      expect(await manager.accessToken(), 'access-1');

      now = now.add(const Duration(minutes: 4, seconds: 30));
      expect(await manager.accessToken(), 'access-2');
      expect(api.refreshedTokens, ['refresh-1']);
    });

    test('concurrent callers share one refresh', () async {
      final manager = createManager();
      await manager.start();
      now = now.add(const Duration(minutes: 15));

      final gate = Completer<void>();
      api.onRefresh = (_) async {
        await gate.future;
        return api.issue('user-1');
      };

      final first = manager.accessToken();
      final second = manager.accessToken();
      gate.complete();

      expect(await Future.wait([first, second]), ['access-2', 'access-2']);
      expect(api.refreshedTokens, hasLength(1));
    });

    test('a user switch discards a refresh that was in flight', () async {
      final manager = createManager();
      await manager.start();
      now = now.add(const Duration(minutes: 15));

      final gate = Completer<void>();
      api.onRefresh = (_) async {
        await gate.future;
        return api.issue('user-1');
      };

      final pending = manager.accessToken();
      await _flush();
      expect(api.refreshedTokens, hasLength(1));

      await manager.applyTokens(api.issue('user-9'), UserChangeReason.merged);
      gate.complete();
      await pending;
      await _flush();

      expect(manager.userId, 'user-9');
      expect((await store.readSession())?.userId, 'user-9');
      expect(changes.last.reason, UserChangeReason.merged);
    });
  });

  group('authorized', () {
    test('renews and retries once after 401 unauthorized', () async {
      final manager = createManager();
      await manager.start();
      final usedTokens = <String>[];

      final result = await manager.authorized((token) async {
        usedTokens.add(token);
        if (usedTokens.length == 1) throw _unauthorized;
        return 'ok';
      });

      expect(result, 'ok');
      expect(usedTokens, ['access-1', 'access-2']);
    });

    test('returns a second 401 to the caller', () async {
      final manager = createManager();
      await manager.start();

      await expectLater(
        manager.authorized<String>((_) async => throw _unauthorized),
        throwsA(isA<ApiException>()),
      );
      expect(api.refreshedTokens, hasLength(1));
    });

    test('does not retry other errors', () async {
      final manager = createManager();
      await manager.start();
      var calls = 0;

      await expectLater(
        manager.authorized<String>((_) async {
          calls++;
          throw const ApiException(statusCode: 409, code: ApiErrorCode.accountExists, message: 'exists');
        }),
        throwsA(isA<ApiException>()),
      );
      expect(calls, 1);
    });
  });

    group('logout', () {
    test('hands the device to a fresh anonymous user', () async {
      final manager = createManager();
      await manager.start();
      await _flush();
      api.onLogout = (_) async => api.issue('user-2');

      await manager.logout();
      await _flush();

      expect(manager.userId, 'user-2');
      // Same device: only the user changes
      expect(manager.installationId, 'install-1');
      expect((await store.readSession())?.userId, 'user-2');
      expect(
        changes.last,
        isA<UserChange>()
            .having((c) => c.reason, 'reason', UserChangeReason.loggedOut)
            .having((c) => c.previousUserId, 'previousUserId', 'user-1'),
      );
    });

    test('an anonymous user cannot sign out', () async {
      final manager = createManager();
      await manager.start();
      await _flush();
      api.onLogout = (_) async => throw const ApiException(
            statusCode: 409,
            code: ApiErrorCode.noLinkedAccount,
            message: 'Link a Google or Apple account before signing out',
          );

      await expectLater(
        manager.logout(),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', ApiErrorCode.noLinkedAccount)),
      );
      expect(manager.userId, 'user-1');
      expect(changes.single.reason, UserChangeReason.signedUp);
    });
  });
}