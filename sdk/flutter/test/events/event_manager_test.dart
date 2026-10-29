import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/consent/consent_store.dart';
import 'package:renvix_sdk/src/events/event_queue.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import '../support/fake_api.dart';

const _offline = NetworkException('offline');

// Waits for background work (SQLite runs in another isolate in tests)
Future<void> _until(bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

Future<void> _settle() => Future<void>.delayed(const Duration(milliseconds: 50));

void main() {
  late DateTime now;
  late FakeApi api;
  late SessionManager session;
  late ConsentManager consent;
  late SqliteEventQueue queue;
  late EventManager events;

  setUpAll(sqfliteFfiInit);

  setUp(() async {
    now = DateTime.utc(2026, 10, 29, 12);
    api = FakeApi(() => now);
    final storage = InMemoryKeyValueStore();

    session = SessionManager(
      api: api,
      store: SessionStore(storage),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
    await session.start();

    consent = ConsentManager(session: session, api: api, store: ConsentStore(storage), clock: () => now);
    await consent.load();
    await consent.sync();

    queue = await SqliteEventQueue.open(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
    var eventCounter = 0;
    events = EventManager(
      session: session,
      consent: consent,
      api: api,
      queue: queue,
      client: testClient,
      clock: () => now,
      newEventId: () => 'event-${++eventCounter}',
      flushInterval: null,
    )..start();
  });

  tearDown(() async {
    await events.dispose();
    await queue.close();
  });

  Future<void> decide({required bool analytics}) async {
    await consent.record(analytics: analytics, personalization: false, source: ConsentSource.firstLaunch);
    await consent.sync();
  }

  Future<List<String>> queued() async => [for (final e in await queue.oldest(1000)) e.eventId];

  List<String> sentNames() => [
        for (final batch in api.eventBatches)
          for (final e in batch.events) e.name,
      ];

  test('does not even store analytics events without consent', () async {
    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    await events.flush();

    expect(await queued(), isEmpty);
    expect(api.eventBatches, isEmpty);
  });

  test('sends events with consent and empties the queue', () async {
    await decide(analytics: true);

    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    events.track('screen_viewed', EventCategory.analytics, {'screen': 'home'});
    await events.flush();

    expect(sentNames(), ['app_opened', 'screen_viewed']);
    expect(api.eventBatches.single.userId, 'user-1');
    expect(api.eventBatches.single.events.first.appVersion, '1.0.0');
    expect(await queued(), isEmpty);
  });

  test('sends essential events without consent', () async {
    events.track('purchase_completed', EventCategory.essential, const {});
    await events.flush();

    expect(sentNames(), ['purchase_completed']);
  });

  test('keeps events while offline and sends them later', () async {
    await decide(analytics: true);
    api.eventsFailure = _offline;

    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    await expectLater(events.flush(), throwsA(isA<NetworkException>()));
    expect(await queued(), hasLength(1));

    api.eventsFailure = null;
    await events.flush();

    expect(sentNames(), ['app_opened']);
    expect(await queued(), isEmpty);
  });

  test('drops rejected events from the queue', () async {
    await decide(analytics: true);
    api.onSendEvents = (sent) async => EventBatchResult(
          accepted: const [],
          rejected: [for (final e in sent) (eventId: e.eventId, reason: 'no_consent')],
        );

    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    await events.flush();

    expect(await queued(), isEmpty);
  });

  test('withdrawing consent deletes queued analytics events', () async {
    await decide(analytics: true);
    api.eventsFailure = _offline;
    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    events.track('purchase_completed', EventCategory.essential, const {});
    await _settle();

    await decide(analytics: false);
    await _settle();

    final remaining = await queue.oldest(10);
    expect(remaining.map((e) => e.name), ['purchase_completed']);
  });

  test('sends a pending consent decision before the events', () async {
    api.consentFailure = _offline;
    await consent.record(analytics: true, personalization: false, source: ConsentSource.firstLaunch);
    events.track('app_opened', EventCategory.analytics, {'cold_start': true});

    await expectLater(events.flush(), throwsA(isA<NetworkException>()));
    expect(api.eventBatches, isEmpty);

    api.consentFailure = null;
    await events.flush();

    expect(api.consentRecords, hasLength(1));
    expect(sentNames(), ['app_opened']);
  });

  test('drops queued events of a previous user', () async {
    await decide(analytics: true);
    api.eventsFailure = _offline;
    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    await _settle();

    // A switch without the chance to send first (e.g. a dead session)
    await session.applyTokens(api.issue('user-2'), UserChangeReason.sessionReset);
    api.eventsFailure = null;
    await events.flush();

    expect(api.eventBatches, isEmpty);
    expect(await queued(), isEmpty);
  });

  test('sends queued events of the current user before logout', () async {
    await decide(analytics: true);
    api.onLogout = (_) async => api.issue('user-2');

    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    await session.logout();

    expect(api.eventBatches.single.userId, 'user-1');
    expect(session.userId, 'user-2');
  });

  test('starts sending on its own once enough events are recorded', () async {
    await decide(analytics: true);

    for (var i = 0; i < EventManager.flushThreshold; i++) {
      events.track('screen_viewed', EventCategory.analytics, {'screen': 'home'});
    }
    await _until(() => api.eventBatches.isNotEmpty);

    expect(api.eventBatches, isNotEmpty);
  });
}