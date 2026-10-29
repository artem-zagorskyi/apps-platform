import 'dart:async';

import 'package:uuid/uuid.dart';

import '../api/platform_api.dart';
import '../consent/consent_manager.dart';
import '../errors.dart';
import '../session/session_manager.dart';
import 'event_queue.dart';
import 'event_tracker.dart';

/// Records events in a durable queue on the device and sends them in batches.
/// Generated tracking code calls [track].
class EventManager implements EventTracker {
  EventManager({
    required this._session,
    required this._consent,
    required this._api,
    required this._queue,
    required this._client,
    DateTime Function()? clock,
    String Function()? newEventId,
    this.flushInterval = const Duration(seconds: 30),
  })  : _clock = clock ?? DateTime.now,
        _newEventId = newEventId ?? (() => const Uuid().v7());

  static const batchSize = 100;

  /// A flush starts once this many events were recorded since the last one
  static const flushThreshold = 50;

  /// Beyond this the oldest analytics events are dropped; essential ones are kept
  static const maxQueued = 10000;

  final SessionManager _session;
  final ConsentManager _consent;
  final PlatformApi _api;
  final EventQueueStore _queue;
  final ClientInfo _client;
  final DateTime Function() _clock;
  final String Function() _newEventId;

  /// Periodic flush; null disables it (tests)
  final Duration? flushInterval;

  // Writes in progress, so a flush includes events tracked a moment ago
  final Set<Future<void>> _writes = {};
  Future<void>? _flushing;
  Timer? _timer;
  int _recordedSinceFlush = 0;
  int _recordedSinceTrim = 0;
  bool _analyticsAllowed = false;
  bool _disposed = false;
  /// Current session id, provided by the usage tracker
  String? Function()? sessionIdProvider;

  /// Called by the SDK at start-up
  void start() {
    _analyticsAllowed = _consent.state.value.analytics;
    _consent.state.addListener(_onConsentChanged);
    _session.beforeUserSwitch = tryFlush;

    final interval = flushInterval;
    if (interval != null) {
      _timer = Timer.periodic(interval, (_) => unawaited(tryFlush()));
    }
  }

  /// Stops sending. Writes and an upload in progress finish first,
  /// so the queue can be closed safely afterwards.
  Future<void> dispose() async {
    _disposed = true;
    _timer?.cancel();
    _consent.state.removeListener(_onConsentChanged);
    _session.beforeUserSwitch = null;

    await Future.wait(_writes.toList());
    final flushing = _flushing;
    if (flushing != null) {
      try {
        await flushing;
      } catch (_) {
        // Its outcome no longer matters
      }
    }
  }

  @override
  void track(String name, EventCategory category, Map<String, Object?> properties) {
    if (_disposed) return;
    // Without consent an analytics event is not even stored on the device
    if (category == EventCategory.analytics && !_consent.state.value.analytics) return;

    final event = QueuedEvent(
      eventId: _newEventId(),
      name: name,
      category: category,
      occurredAt: _clock(),
      sessionId: sessionIdProvider?.call(),
      userId: _session.userId,
      appVersion: _client.appVersion,
      appBuild: _client.appBuild,
      osVersion: _client.osVersion,
      properties: properties,
    );

    final write = _enqueue(event);
    _writes.add(write);
    unawaited(write.whenComplete(() => _writes.remove(write)));
  }

  /// Sends queued events. Throws NetworkException / ServerException while
  /// the server is unreachable; the events stay queued.
  Future<void> flush() {
    if (_disposed) return _flushing ?? Future.value();
    return _flushing ??= _flushOnce().whenComplete(() {
      _flushing = null;
    });
  }

  /// Like [flush], but failures are ignored: the events stay queued and
  /// the next trigger retries
  Future<void> tryFlush() async {
    try {
      await flush();
    } on AppPlatformException {
      // Offline or the server is unavailable
    } catch (_) {
      // Storage failure: nothing is lost, the next trigger retries
    }
  }

  /// Number of events waiting on the device, including ones being written
  Future<int> queuedCount() async {
    await Future.wait(_writes.toList());
    return _queue.count();
  }

  Future<void> _enqueue(QueuedEvent event) async {
    try {
      await _queue.add(event);
      if (++_recordedSinceTrim >= 100) {
        _recordedSinceTrim = 0;
        await _queue.trimAnalytics(maxQueued);
      }
    } catch (_) {
      // A storage failure must not crash the app; one event is lost
      return;
    }
    if (++_recordedSinceFlush >= flushThreshold) unawaited(tryFlush());
  }

  Future<void> _flushOnce() async {
    await Future.wait(_writes.toList());
    _recordedSinceFlush = 0;

    // Consent decisions first: the server drops analytics events it has no
    // consent for. If they cannot be sent now, the events wait too.
    if (_consent.hasPendingDecisions) {
      await _consent.sync();
      if (_consent.hasPendingDecisions) return;
    }

    // Creates the user if the device has none yet (first launch offline)
    await _session.accessToken();
    final userId = _session.userId;

    // Stops if the device switches users meanwhile
    while (_session.userId == userId) {
      final batch = await _queue.oldest(batchSize);
      if (batch.isEmpty) return;

      // Events of a previous user cannot be sent with this user's token
      final foreign = [
        for (final e in batch)
          if (e.userId != null && e.userId != userId) e.eventId,
      ];
      if (foreign.isNotEmpty) await _queue.remove(foreign);

      // Events recorded before the device had a user belong to this one
      final sendable = [
        for (final e in batch)
          if (e.userId == null || e.userId == userId) e,
      ];
      if (sendable.isEmpty) continue;

      final sentAt = _clock();
      final result = await _session.authorized(
        (token) => _api.sendEvents(token, sentAt: sentAt, events: sendable),
      );

      final done = {...result.accepted, ...result.rejected.map((r) => r.eventId)};
      await _queue.remove(done);

      // Something was neither accepted nor rejected: retry later, do not loop
      if (done.length < sendable.length) return;
    }
  }

  void _onConsentChanged() {
    final allowed = _consent.state.value.analytics;
    if (_analyticsAllowed && !allowed) unawaited(_dropQueuedAnalytics());
    _analyticsAllowed = allowed;
  }

  // Withdrawn consent: analytics events not sent yet are deleted, never sent
  Future<void> _dropQueuedAnalytics() async {
    try {
      // Events tracked just before the withdrawal are still being written
      await Future.wait(_writes.toList());
      await _queue.removeAnalytics();
    } catch (_) {
      // Retried on the next withdrawal; the server rejects them anyway
    }
  }
}