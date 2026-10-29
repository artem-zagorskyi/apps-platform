import 'dart:convert';
import 'dart:math';

import 'package:sqflite/sqflite.dart';

import 'event_tracker.dart';

/// An event waiting on the device to be sent.
class QueuedEvent {
  const QueuedEvent({
    required this.eventId,
    required this.name,
    required this.category,
    required this.occurredAt,
    required this.sessionId,
    required this.userId,
    required this.appVersion,
    required this.appBuild,
    required this.osVersion,
    required this.properties,
    this.seq = 0,
  });

  final String eventId;
  final String name;
  final EventCategory category;

  /// Device clock; the server corrects it
  final DateTime occurredAt;
  final String? sessionId;

  /// User at the time of the event; null before the device had a user
  final String? userId;
  final String appVersion;
  final String appBuild;
  final String osVersion;
  final Map<String, Object?> properties;

  /// Position in this installation's event stream, assigned by the queue
  final int seq;
}

/// Durable queue of events on the device.
abstract interface class EventQueueStore {
  Future<void> add(QueuedEvent event);

  /// Oldest first
  Future<List<QueuedEvent>> oldest(int limit);
  Future<void> remove(Iterable<String> eventIds);

  /// Consent withdrawn: analytics events not sent yet are deleted
  Future<void> removeAnalytics();

  /// Keeps the queue within [max] events by dropping the oldest analytics
  /// events; essential events are never dropped
  Future<void> trimAnalytics(int max);
  Future<int> count();
}

/// Event queue in the SDK's own SQLite database.
class SqliteEventQueue implements EventQueueStore {
  SqliteEventQueue._(this._db);

  static const fileName = 'app_platform_events.db';
  static const _table = 'event_queue';

  // seq: AUTOINCREMENT never reuses a number, even after deletes
  static const _createTable = '''
    CREATE TABLE event_queue (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      session_id TEXT,
      user_id TEXT,
      app_version TEXT NOT NULL,
      app_build TEXT NOT NULL,
      os_version TEXT NOT NULL,
      properties TEXT NOT NULL
    )''';

  final Database _db;

  /// [factory] and [path] are for tests (in-memory SQLite on the host)
  static Future<SqliteEventQueue> open({DatabaseFactory? factory, String? path}) async {
    final dbFactory = factory ?? databaseFactory;
    final dbPath = path ?? '${await dbFactory.getDatabasesPath()}/$fileName';
    final db = await dbFactory.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) => db.execute(_createTable),
      ),
    );
    return SqliteEventQueue._(db);
  }

  @override
  Future<void> add(QueuedEvent event) async {
    await _db.insert(
      _table,
      {
        'event_id': event.eventId,
        'name': event.name,
        'category': event.category.name,
        'occurred_at': event.occurredAt.millisecondsSinceEpoch,
        'session_id': event.sessionId,
        'user_id': event.userId,
        'app_version': event.appVersion,
        'app_build': event.appBuild,
        'os_version': event.osVersion,
        'properties': jsonEncode(event.properties),
      },
      // The same event id twice is stored once
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  @override
  Future<List<QueuedEvent>> oldest(int limit) async {
    final rows = await _db.query(_table, orderBy: 'seq', limit: limit);
    return rows.map(_fromRow).toList();
  }

  @override
  Future<void> remove(Iterable<String> eventIds) async {
    final ids = eventIds.toList();
    // SQLite limits the number of parameters in one statement
    for (var start = 0; start < ids.length; start += 500) {
      final chunk = ids.sublist(start, min(start + 500, ids.length));
      await _db.delete(
        _table,
        where: 'event_id IN (${List.filled(chunk.length, '?').join(', ')})',
        whereArgs: chunk,
      );
    }
  }

  @override
  Future<void> removeAnalytics() async {
    await _db.delete(_table, where: 'category = ?', whereArgs: [EventCategory.analytics.name]);
  }

  @override
  Future<void> trimAnalytics(int max) async {
    final excess = await count() - max;
    if (excess <= 0) return;
    await _db.rawDelete(
      'DELETE FROM $_table WHERE seq IN '
      '(SELECT seq FROM $_table WHERE category = ? ORDER BY seq LIMIT ?)',
      [EventCategory.analytics.name, excess],
    );
  }

  @override
  Future<int> count() async {
    return Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM $_table')) ?? 0;
  }

  Future<void> close() => _db.close();

  static QueuedEvent _fromRow(Map<String, Object?> row) {
    return QueuedEvent(
      seq: row['seq'] as int,
      eventId: row['event_id'] as String,
      name: row['name'] as String,
      category: EventCategory.values.byName(row['category'] as String),
      occurredAt: DateTime.fromMillisecondsSinceEpoch(row['occurred_at'] as int, isUtc: true),
      sessionId: row['session_id'] as String?,
      userId: row['user_id'] as String?,
      appVersion: row['app_version'] as String,
      appBuild: row['app_build'] as String,
      osVersion: row['os_version'] as String,
      properties: jsonDecode(row['properties'] as String) as Map<String, Object?>,
    );
  }
}