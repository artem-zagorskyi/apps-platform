import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/events/platform_events.g.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import '../support/fake_api.dart';

class RecordingTracker implements EventTracker {
  final events = <({String name, Map<String, Object?> properties})>[];

  @override
  void track(String name, EventCategory category, Map<String, Object?> properties) {
    events.add((name: name, properties: properties));
  }
}

const _granted = ConsentState(
  status: ConsentStatus.decided,
  analytics: true,
  personalization: false,
  canAskAgainAt: null,
  policyVersion: 'v1',
);

const _paywall = ServerConfig(
  version: 3,
  values: {'paywall_variant': 'trial_first', 'daily_goal_minutes': 20},
  experiments: [
    ConfigExperiment(key: 'paywall_test', variant: 'trial', parameters: ['paywall_variant']),
  ],
);

const _longerGoal = ServerConfig(version: 4, values: {'daily_goal_minutes': 30}, experiments: []);

// Waits for background work: requests and storage writes
Future<void> _until(bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  late DateTime now;
  late FakeApi api;
  late InMemoryKeyValueStore storage;
  late SessionManager session;
  late RecordingTracker tracker;
  late ValueNotifier<ConsentState> consent;
  late String? sessionId;
  final managers = <ConfigManager>[];

  setUp(() async {
    now = DateTime.utc(2026, 10, 30, 12);
    api = FakeApi(() => now);
    storage = InMemoryKeyValueStore();
    session = SessionManager(
      api: api,
      store: SessionStore(storage),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
    await session.start();
    tracker = RecordingTracker();
    consent = ValueNotifier(_granted);
    sessionId = 'session-1';
  });

  tearDown(() {
    for (final manager in managers) {
      manager.dispose();
    }
    managers.clear();
  });

  // A new manager over the same storage: like a new launch of the app
  Future<ConfigManager> launch() async {
    for (final manager in managers) {
      manager.dispose();
    }
    managers.clear();

    final manager = ConfigManager(
      session: session,
      api: api,
      store: storage,
      client: testClient,
      events: PlatformEvents(tracker),
      consent: consent,
      sessionId: () => sessionId,
      clock: () => now,
      firstLaunchWait: const Duration(milliseconds: 20),
    );
    managers.add(manager);
    await manager.start();
    return manager;
  }

  int goal(ConfigManager config) => config.readInt('daily_goal_minutes', defaultValue: 10, min: 5, max: 60);

  String variant(ConfigManager config, {List<String> values = const ['classic', 'trial_first']}) =>
      config.readEnum('paywall_variant', defaultValue: 'classic', values: values);

  List<Map<String, Object?>> exposures() => [
        for (final e in tracker.events)
          if (e.name == 'experiment_exposed') e.properties,
      ];

  test('the first launch waits for the server and applies its config', () async {
    api.setServerConfig('user-1', _paywall);

    final config = await launch();

    expect(config.version, 3);
    expect(goal(config), 20);
    expect(variant(config), 'trial_first');
    expect(api.configRequests.single.appVersion, testClient.appVersion);
  });

  test('a slow first answer waits for the next launch', () async {
    api.setServerConfig('user-1', _paywall);
    final answer = Completer<void>();
    api.onGetConfig = () => answer.future;

    final config = await launch();
    expect(goal(config), 10);

    answer.complete();
    await _until(() => config.hasPending);
    // Still the defaults in this launch
    expect(goal(config), 10);

    api.onGetConfig = null;
    expect(goal(await launch()), 20);
  });

  test('later launches use the stored config at once and fetch the next one', () async {
    api.setServerConfig('user-1', _paywall);
    await launch();
    api.setServerConfig('user-1', _longerGoal);

    final second = await launch();
    expect(goal(second), 20);
    await _until(() => second.hasPending);

    expect(goal(await launch()), 30);
  });

  test('sends the ETag and keeps the config when nothing changed', () async {
    api.setServerConfig('user-1', _paywall);
    await launch();

    final second = await launch();
    await _until(() => api.configRequests.length == 2);
    await _until(() => second.fetchedAt != null);

    expect(api.configRequests.last.etag, '"user-1:3"');
    expect(second.hasPending, isFalse);
    expect(second.version, 3);
  });

  test('activate applies a fetched config now and notifies listeners', () async {
    api.setServerConfig('user-1', _paywall);
    final config = await launch();
    api.setServerConfig('user-1', _longerGoal);
    var notified = 0;
    config.addListener(() => notified++);

    await config.fetch();
    expect(goal(config), 20);
    await config.activate();

    expect(goal(config), 30);
    expect(config.hasPending, isFalse);
    expect(notified, 1);
  });

  test("a user change drops the old config and applies the new user's at once", () async {
    api.setServerConfig('user-1', _paywall);
    api.setServerConfig('user-2', _longerGoal);
    final config = await launch();
    final answer = Completer<void>();
    api.onGetConfig = () => answer.future;

    await session.applyTokens(api.issue('user-2'), UserChangeReason.loggedOut);
    await _until(() => api.configRequests.length == 2);

    // The previous user's values are gone before the answer
    expect(goal(config), 10);

    answer.complete();
    await _until(() => config.version == 4);

    expect(goal(config), 30);
    expect(api.configRequests.last.userId, 'user-2');
  });

  test('a stored config of another user is not used', () async {
    api.setServerConfig('user-1', _paywall);
    final first = await launch();
    first.dispose();
    managers.clear();
    // The session changed while the app was closed
    await session.applyTokens(api.issue('user-2'), UserChangeReason.sessionReset);

    final second = await launch();

    expect(goal(second), 10);
  });

  test('offline keeps the defaults and the next trigger fetches', () async {
    api.setServerConfig('user-1', _paywall);
    api.configFailure = const NetworkException('offline');

    final config = await launch();
    expect(goal(config), 10);

    api.configFailure = null;
    config.onForeground();
    await _until(() => config.hasPending);

    expect(config.hasPending, isTrue);
  });

  group('exposures', () {
    test('are recorded once per session for experiment parameters', () async {
      api.setServerConfig('user-1', _paywall);
      final config = await launch();

      variant(config);
      variant(config);
      goal(config);

      expect(exposures(), [
        {'experiment': 'paywall_test', 'variant': 'trial', 'config_version': 3},
      ]);

      sessionId = 'session-2';
      variant(config);

      expect(exposures(), hasLength(2));
    });

    test('are not recorded for forced testers', () async {
      api.setServerConfig(
        'user-1',
        const ServerConfig(
          version: 3,
          values: {'paywall_variant': 'trial_first'},
          experiments: [
            ConfigExperiment(key: 'paywall_test', variant: 'trial', parameters: ['paywall_variant'], forced: true),
          ],
        ),
      );
      final config = await launch();

      expect(variant(config), 'trial_first');
      expect(exposures(), isEmpty);
    });

    test('are not recorded when this app version cannot use the value', () async {
      api.setServerConfig('user-1', _paywall);
      final config = await launch();

      // An older app version without trial_first sees its default
      expect(variant(config, values: ['classic']), 'classic');
      expect(exposures(), isEmpty);
    });

    test('wait for consent within the session', () async {
      api.setServerConfig('user-1', _paywall);
      consent.value = ConsentState.initial;
      final config = await launch();

      variant(config);
      expect(exposures(), isEmpty);

      consent.value = _granted;
      variant(config);

      expect(exposures(), hasLength(1));
    });
  });
}