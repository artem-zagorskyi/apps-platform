import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/api/platform_api.dart';
import 'package:renvix_sdk/src/events/event_queue.dart';

const _tokenPairJson = {
  'userId': 'user-1',
  'accessToken': 'access-1',
  'accessTokenExpiresIn': 900,
  'refreshToken': 'refresh-1',
  'refreshTokenExpiresAt': '2027-01-24T19:29:34.737Z',
};

http.Response _json(Object body, int status) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

PlatformApi _api(
  MockClientHandler handler, {
  String baseUrl = 'http://10.0.2.2:3000',
  Duration timeout = const Duration(seconds: 5),
}) {
  return PlatformApi(
    baseUri: Uri.parse(baseUrl),
    client: MockClient(handler),
    timeout: timeout,
  );
}

Future<TokenPair> _signUp(PlatformApi api) => api.signUpAnonymous(
  appId: 'app-1',
  installationId: 'install-1',
  platform: DevicePlatform.android,
  appVersion: '1.0.0',
  appBuild: '1',
  osVersion: '17',
);

void main() {
  test('sends the sign-up request and parses the token pair', () async {
    late http.Request sent;
    final api = _api((request) async {
      sent = request;
      return _json(_tokenPairJson, 201);
    });

    final tokens = await _signUp(api);

    expect(sent.method, 'POST');
    expect(sent.url.toString(), 'http://10.0.2.2:3000/v1/auth/anonymous');
    expect(sent.headers['content-type'], startsWith('application/json'));
    expect(jsonDecode(sent.body), {
      'appId': 'app-1',
      'installationId': 'install-1',
      'platform': 'android',
      'appVersion': '1.0.0',
      'appBuild': '1',
      'osVersion': '17',
    });

    expect(tokens.userId, 'user-1');
    expect(tokens.accessTokenExpiresIn, const Duration(minutes: 15));
    expect(
      tokens.refreshTokenExpiresAt,
      DateTime.utc(2027, 1, 24, 19, 29, 34, 737),
    );
  });

  test('keeps a path in the base URL', () async {
    late Uri url;
    final api = _api((request) async {
      url = request.url;
      return _json(_tokenPairJson, 200);
    }, baseUrl: 'https://example.com/api/');

    await api.refresh('refresh-1');

    expect(url.toString(), 'https://example.com/api/v1/auth/refresh');
  });

  test('turns a 4xx error into ApiException with its code', () async {
    final api = _api(
      (_) async => _json({
        'error': 'installation_exists',
        'message': 'Installation id is already registered',
      }, 409),
    );

    await expectLater(
      _signUp(api),
      throwsA(
        isA<ApiException>()
            .having((e) => e.statusCode, 'statusCode', 409)
            .having((e) => e.code, 'code', ApiErrorCode.installationExists),
      ),
    );
  });

  test('turns 5xx into ServerException, even without a JSON body', () async {
    final api = _api((_) async => http.Response('Bad Gateway', 502));

    await expectLater(
      api.refresh('refresh-1'),
      throwsA(
        isA<ServerException>().having((e) => e.statusCode, 'statusCode', 502),
      ),
    );
  });

  test('turns 429 into ServerException', () async {
    final api = _api(
      (_) async =>
          _json({'error': 'too_many_requests', 'message': 'Slow down'}, 429),
    );

    await expectLater(
      api.refresh('refresh-1'),
      throwsA(isA<ServerException>()),
    );
  });

  test('turns a connection failure into NetworkException', () async {
    final api = _api(
      (_) async => throw http.ClientException('Connection refused'),
    );

    await expectLater(
      api.refresh('refresh-1'),
      throwsA(isA<NetworkException>()),
    );
  });

  test('turns a timeout into NetworkException', () async {
    final api = _api((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 200));
      return _json(_tokenPairJson, 200);
    }, timeout: const Duration(milliseconds: 20));

    await expectLater(
      api.refresh('refresh-1'),
      throwsA(isA<NetworkException>()),
    );
  });

  test('turns a malformed success response into ServerException', () async {
    final api = _api((_) async => _json({'userId': 42}, 200));

    await expectLater(
      api.refresh('refresh-1'),
      throwsA(isA<ServerException>()),
    );
  });

  test('requests a nonce without a body', () async {
    late http.Request sent;
    final api = _api((request) async {
      sent = request;
      return _json({
        'nonce': 'n-1',
        'expiresAt': '2026-10-28T12:10:00.000Z',
      }, 200);
    });

    final nonce = await api.issueNonce('access-1');

    expect(sent.method, 'POST');
    expect(sent.url.path, '/v1/auth/nonce');
    expect(sent.headers['authorization'], 'Bearer access-1');
    expect(sent.headers.containsKey('content-type'), isFalse);
    expect(nonce.nonce, 'n-1');
  });

  test(
    'sends the Google token with a merge strategy and parses signed_in',
    () async {
      late http.Request sent;
      final api = _api((request) async {
        sent = request;
        return _json({
          'result': 'signed_in',
          'userId': 'user-9',
          'tokens': _tokenPairJson,
        }, 200);
      });

      final response = await api.signInWithGoogle(
        'access-1',
        idToken: 'google-id-token',
        mergeStrategy: MergeStrategy.keepTarget,
      );

      expect(sent.url.path, '/v1/auth/google');
      expect(jsonDecode(sent.body), {
        'idToken': 'google-id-token',
        'mergeStrategy': 'keep_target',
      });
      expect(response.outcome, ProviderSignInOutcome.signedIn);
      expect(response.tokens?.userId, 'user-1');
    },
  );

  test('signs out without a body and parses the new token pair', () async {
    late http.Request sent;
    final api = _api((request) async {
      sent = request;
      return _json(_tokenPairJson, 200);
    });

    final tokens = await api.logout('access-1');

    expect(sent.method, 'POST');
    expect(sent.url.path, '/v1/auth/logout');
    expect(sent.headers['authorization'], 'Bearer access-1');
    expect(sent.headers.containsKey('content-type'), isFalse);
    expect(tokens.userId, 'user-1');
  });

  test(
    'loads the consent state and skips purposes the SDK does not handle',
    () async {
      final api = _api(
        (_) async => _json({
          'policy': {'region': '*', 'mode': 'optional', 'version': 'v1'},
          'status': 'decided',
          'decisions': [
            {
              'purpose': 'analytics',
              'granted': true,
              'policyVersion': 'v1',
              'decidedAt': '2026-10-29T10:00:00.000Z',
            },
            {
              'purpose': 'ads',
              'granted': false,
              'policyVersion': 'v1',
              'decidedAt': '2026-10-29T10:00:00.000Z',
            },
          ],
          'canAskAgainAt': null,
        }, 200),
      );

      final state = await api.getConsent('access-1');

      expect(state.mode, ConsentMode.optional);
      expect(state.policyVersion, 'v1');
      expect(state.decisions.keys, [ConsentPurpose.analytics]);
      expect(state.decisions[ConsentPurpose.analytics]?.granted, isTrue);
    },
  );

  test('records consent with wire names and UTC millisecond times', () async {
    late http.Request sent;
    final api = _api((request) async {
      sent = request;
      return _json({
        'policy': {'region': '*', 'mode': 'optional', 'version': 'v1'},
        'status': 'needs_decision',
        'decisions': <Object>[],
        'canAskAgainAt': null,
      }, 200);
    });

    await api.recordConsent(
      'access-1',
      decisions: {ConsentPurpose.analytics: true},
      policyVersion: 'v1',
      source: ConsentSource.firstLaunch,
      decidedAt: DateTime.utc(2026, 10, 29, 10, 0, 0, 0, 123),
      sentAt: DateTime.utc(2026, 10, 29, 10, 5),
    );

    expect(jsonDecode(sent.body), {
      'decisions': {'analytics': true},
      'policyVersion': 'v1',
      'source': 'first_launch',
      'decidedAt': '2026-10-29T10:00:00.000Z',
      'sentAt': '2026-10-29T10:05:00.000Z',
    });
  });

  test('loads the current user with the access token', () async {
    late http.Request sent;
    final api = _api((request) async {
      sent = request;
      return _json({
        'userId': 'user-1',
        'appId': 'app-1',
        'installationId': 'install-1',
        'platform': 'android',
        'createdAt': '2026-10-28T10:00:00.000Z',
        'providers': [
          {'provider': 'google', 'email': 'player@gmail.com'},
        ],
      }, 200);
    });

    final user = await api.getMe('access-1');

    expect(sent.method, 'GET');
    expect(sent.url.path, '/v1/me');
    expect(sent.headers['authorization'], 'Bearer access-1');
    expect(sent.headers.containsKey('content-type'), isFalse);
    expect(user.platform, DevicePlatform.android);
    expect(user.isAnonymous, isFalse);
    expect(user.linkedAccounts.single.provider, AuthProvider.google);
    expect(user.linkedAccounts.single.email, 'player@gmail.com');
  });

  test('sends an event batch without the category', () async {
    late http.Request sent;
    final api = _api((request) async {
      sent = request;
      return _json({'accepted': ['e-1'], 'rejected': <Object>[]}, 200);
    });

    final result = await api.sendEvents(
      'access-1',
      sentAt: DateTime.utc(2026, 10, 29, 12, 5),
      events: [
        QueuedEvent(
          eventId: 'e-1',
          name: 'app_opened',
          category: EventCategory.analytics,
          occurredAt: DateTime.utc(2026, 10, 29, 12),
          sessionId: null,
          userId: 'user-1',
          appVersion: '1.0.0',
          appBuild: '1',
          osVersion: '17',
          properties: const {'cold_start': true},
          seq: 7,
        ),
      ],
    );

    expect(sent.url.path, '/v1/events');
    expect(jsonDecode(sent.body), {
      'sentAt': '2026-10-29T12:05:00.000Z',
      'events': [
        {
          'eventId': 'e-1',
          'name': 'app_opened',
          'occurredAt': '2026-10-29T12:00:00.000Z',
          'sessionId': null,
          'seq': 7,
          'appVersion': '1.0.0',
          'appBuild': '1',
          'osVersion': '17',
          'properties': {'cold_start': true},
        },
      ],
    });
    expect(result.accepted, ['e-1']);
  });
}
