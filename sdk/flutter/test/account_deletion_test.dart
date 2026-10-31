import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';
import 'package:renvix_sdk/src/consent/consent_store.dart';
import 'package:renvix_sdk/src/events/event_queue.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_api.dart';

const _offline = NetworkException('offline');

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
    now = DateTime.utc(2026, 10, 31, 12);
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
    await consent.record(analytics: true, personalization: true, source: ConsentSource.firstLaunch);
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

  test('hands the device to a new user and reports the deletion', () async {
    final changes = <UserChange>[];
    final subscription = session.userChanges.listen(changes.add);

    await session.deleteAccount();
    await _settle();

    expect(api.deletedUsers, ['user-1']);
    expect(session.userId, 'user-2');
    expect(changes.single.reason, UserChangeReason.accountDeleted);
    expect(changes.single.previousUserId, 'user-1');
    await subscription.cancel();
  });

  test('drops events queued for the deleted user instead of sending them', () async {
    api.eventsFailure = _offline;
    events.track('app_opened', EventCategory.analytics, {'cold_start': true});
    await _settle();
    api.eventsFailure = null;

    await session.deleteAccount();
    await events.flush();

    // Nothing was sent before the deletion, and nothing after it
    expect(api.eventBatches, isEmpty);
    expect(await queue.count(), 0);
  });

  test('asks the new person for consent again', () async {
    await session.deleteAccount();
    await _settle();
    await consent.sync();

    expect(consent.state.value.status, ConsentStatus.needsDecision);
    expect(consent.state.value.analytics, isFalse);
  });

  test('changes nothing while offline', () async {
    api.onDeleteAccount = (_) async => throw _offline;

    await expectLater(session.deleteAccount(), throwsA(isA<NetworkException>()));

    expect(session.userId, 'user-1');
    expect(consent.state.value.analytics, isTrue);
  });
}