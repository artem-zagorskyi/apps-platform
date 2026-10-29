import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/events/app_usage.dart';
import 'package:renvix_sdk/src/events/platform_events.g.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import '../support/fake_api.dart';

/// Records tracked events together with the session they belong to
class RecordingTracker implements EventTracker {
  final events = <({String name, Map<String, Object?> properties, String? sessionId})>[];
  String? Function()? sessionId;

  @override
  void track(String name, EventCategory category, Map<String, Object?> properties) {
    events.add((name: name, properties: properties, sessionId: sessionId?.call()));
  }
}

const _granted = ConsentState(
  status: ConsentStatus.decided,
  analytics: true,
  personalization: false,
  canAskAgainAt: null,
  policyVersion: 'v1',
);

const _oldClient = ClientInfo(
  appId: 'app-1',
  platform: DevicePlatform.android,
  appVersion: '0.9.0',
  appBuild: '7',
  osVersion: '17',
);

Future<void> _settle() => Future<void>.delayed(Duration.zero);

void main() {
  late DateTime now;
  late InMemoryKeyValueStore storage;
  late RecordingTracker tracker;
  late ValueNotifier<ConsentState> consent;
  late int flushes;
  late int sessionCounter;

  setUp(() {
    now = DateTime.utc(2026, 10, 29, 12);
    storage = InMemoryKeyValueStore();
    tracker = RecordingTracker();
    consent = ValueNotifier(_granted);
    flushes = 0;
    sessionCounter = 0;
  });

  // A fresh tracker over the same storage: like a new process
  AppUsageTracker launch({ClientInfo client = testClient}) {
    final usage = AppUsageTracker(
      store: storage,
      events: PlatformEvents(tracker),
      consent: consent,
      client: client,
      flush: () async => flushes++,
      clock: () => now,
      newSessionId: () => 'session-${++sessionCounter}',
    );
    tracker.sessionId = () => usage.sessionId;
    return usage;
  }

  List<String> names() => [for (final e in tracker.events) e.name];

  test('first launch records install, session start and open', () async {
    final usage = launch();

    await usage.start();

    expect(names(), ['app_installed', 'session_started', 'app_opened']);
    expect(tracker.events.last.properties, {'cold_start': true});
    expect(tracker.events.every((e) => e.sessionId == 'session-1'), isTrue);
  });

  test('install and session start wait for consent', () async {
    consent.value = ConsentState.initial;
    final usage = launch();

    await usage.start();
    expect(names(), isEmpty);

    consent.value = _granted;
    await _settle();

    // The open itself is not recorded later: only the facts are kept
    expect(names(), ['app_installed', 'session_started']);
  });

  test('coming back within 30 minutes continues the session', () async {
    final usage = launch();
    await usage.start();
    now = now.add(const Duration(minutes: 1));
    await usage.onBackground();
    now = now.add(const Duration(minutes: 5));
    tracker.events.clear();

    await usage.onForeground();

    expect(names(), ['app_opened']);
    expect(tracker.events.single.properties, {'cold_start': false});
    expect(usage.sessionId, 'session-1');
  });

  test('a restarted process within 30 minutes continues the session', () async {
    final first = launch();
    await first.start();
    await first.onBackground();
    first.dispose();
    now = now.add(const Duration(minutes: 10));
    tracker.events.clear();

    final second = launch();
    await second.start();

    expect(names(), ['app_opened']);
    expect(tracker.events.single.properties, {'cold_start': true});
    expect(second.sessionId, 'session-1');
  });

  test('after 30 minutes the old session ends with its foreground time', () async {
    final usage = launch();
    await usage.start();
    now = now.add(const Duration(minutes: 2));
    await usage.onBackground();
    now = now.add(const Duration(minutes: 31));
    tracker.events.clear();

    await usage.onForeground();

    expect(names(), ['session_ended', 'session_started', 'app_opened']);
    expect(tracker.events.first.properties, {'duration_seconds': 120});
    expect(tracker.events.first.sessionId, 'session-1');
    expect(tracker.events.last.sessionId, 'session-2');
  });

  test('records an update with the previous version', () async {
    final old = launch(client: _oldClient);
    await old.start();
    await old.onBackground();
    old.dispose();
    tracker.events.clear();

    await launch().start();

    final update = tracker.events.firstWhere((e) => e.name == 'app_updated');
    expect(update.properties, {'previous_version': '0.9.0', 'previous_build': '7'});
    expect(names(), isNot(contains('app_installed')));
  });

  test('going to the background sends the queue', () async {
    final usage = launch();
    await usage.start();

    await usage.onBackground();

    expect(flushes, 1);
  });

  test('a session whose start was never recorded gets no end', () async {
    consent.value = ConsentState.initial;
    final first = launch();
    await first.start();
    await first.onBackground();
    first.dispose();
    now = now.add(const Duration(minutes: 31));
    consent.value = _granted;

    await launch().start();

    expect(names(), ['app_installed', 'session_started', 'app_opened']);
  });
}