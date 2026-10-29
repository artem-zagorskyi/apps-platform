import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/events/event_queue.dart';
import 'package:renvix_sdk/src/events/event_tracker.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

QueuedEvent _event(String id, {EventCategory category = EventCategory.analytics}) {
  return QueuedEvent(
    eventId: id,
    name: 'app_opened',
    category: category,
    occurredAt: DateTime.utc(2026, 10, 29, 12),
    sessionId: null,
    userId: 'user-1',
    appVersion: '1.0.0',
    appBuild: '1',
    osVersion: '17',
    properties: const {'cold_start': true},
  );
}

void main() {
  late SqliteEventQueue queue;

  setUpAll(sqfliteFfiInit);

  setUp(() async {
    // Real SQLite on the host, in memory
    queue = await SqliteEventQueue.open(factory: databaseFactoryFfi, path: inMemoryDatabasePath);
  });

  tearDown(() => queue.close());

  Future<List<String>> ids() async => [for (final e in await queue.oldest(1000)) e.eventId];

  test('keeps events in order with growing sequence numbers', () async {
    await queue.add(_event('a'));
    await queue.add(_event('b'));
    await queue.add(_event('c'));

    final events = await queue.oldest(10);

    expect(events.map((e) => e.eventId), ['a', 'b', 'c']);
    expect(events[0].seq < events[1].seq && events[1].seq < events[2].seq, isTrue);
    expect(events.first.properties, {'cold_start': true});
    expect(events.first.occurredAt, DateTime.utc(2026, 10, 29, 12));
  });

  test('stores the same event id once', () async {
    await queue.add(_event('a'));
    await queue.add(_event('a'));

    expect(await queue.count(), 1);
  });

  test('removes events by id', () async {
    await queue.add(_event('a'));
    await queue.add(_event('b'));

    await queue.remove(['a']);

    expect(await ids(), ['b']);
  });

  test('drops analytics events and keeps essential ones on withdrawal', () async {
    await queue.add(_event('a'));
    await queue.add(_event('b', category: EventCategory.essential));

    await queue.removeAnalytics();

    expect(await ids(), ['b']);
  });

  test('trims the oldest analytics events beyond the limit', () async {
    await queue.add(_event('a'));
    await queue.add(_event('b', category: EventCategory.essential));
    await queue.add(_event('c'));
    await queue.add(_event('d'));

    await queue.trimAnalytics(2);

    expect(await ids(), ['b', 'd']);
  });
}