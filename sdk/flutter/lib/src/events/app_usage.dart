import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../api/models.dart';
import '../consent/consent_manager.dart';
import '../session/session_manager.dart';
import '../storage/session_store.dart';
import 'platform_events.g.dart';

/// Standard usage events: install, update, app opens and sessions.
///
/// A session continues if the app comes back within 30 minutes, even after
/// the system stopped the process. Install and session start that happen
/// before analytics consent are remembered as facts (not event data) and
/// recorded once consent is given.
class AppUsageTracker {
  AppUsageTracker({
    required this._store,
    required this._events,
    required this._consent,
    required this._client,
    required this._flush,
    DateTime Function()? clock,
    String Function()? newSessionId,
    String keyPrefix = 'app_platform',
  })  : _clock = clock ?? DateTime.now,
        _newSessionId = newSessionId ?? (() => const Uuid().v7()),
        _key = '$keyPrefix.usage';

  static const sessionTimeout = Duration(minutes: 30);

  final KeyValueStore _store;
  final PlatformEvents _events;
  final ValueListenable<ConsentState> _consent;
  final ClientInfo _client;
  final Future<void> Function() _flush;
  final DateTime Function() _clock;
  final String Function() _newSessionId;
  final String _key;

  _UsageState _state = _UsageState();
  DateTime? _foregroundSince;
  bool _inForeground = false;

  /// Current session; attached to every event
  String? get sessionId => _state.session?.id;

  bool get _allowed => _consent.value.analytics;

  /// Cold start of the app
  Future<void> start() async {
    _state = await _load();

    final previousVersion = _state.appVersion;
    final previousBuild = _state.appBuild;
    final ({String version, String build})? updatedFrom;
    if (previousVersion == null || previousBuild == null) {
      _state.installPending = true;
      updatedFrom = null;
    } else if (previousVersion != _client.appVersion || previousBuild != _client.appBuild) {
      updatedFrom = (version: previousVersion, build: previousBuild);
    } else {
      updatedFrom = null;
    }
    _state
      ..appVersion = _client.appVersion
      ..appBuild = _client.appBuild;

    _consent.addListener(_onConsentChanged);
    await _foreground(coldStart: true, updatedFrom: updatedFrom);
  }

  /// The app came back from the background
  Future<void> onForeground() => _foreground(coldStart: false);

  /// The app went to the background
  Future<void> onBackground() async {
    if (!_inForeground) return;
    _inForeground = false;

    final now = _clock();
    final session = _state.session;
    final since = _foregroundSince;
    if (session != null) {
      if (since != null) session.foregroundMs += now.difference(since).inMilliseconds;
      session.backgroundAt = now;
    }
    _foregroundSince = null;

    await _save();
    // The last chance to send before the system may stop the app
    await _flush();
  }

  void dispose() {
    _consent.removeListener(_onConsentChanged);
  }

  Future<void> _foreground({
    required bool coldStart,
    ({String version, String build})? updatedFrom,
  }) async {
    if (_inForeground) return;
    _inForeground = true;

    final now = _clock();
    final session = _state.session;
    final backgroundAt = session?.backgroundAt;

    if (session != null && backgroundAt != null && now.difference(backgroundAt) <= sessionTimeout) {
      // Back within 30 minutes: the same session goes on
      session.backgroundAt = null;
    } else {
      // Only sessions whose start was recorded get an end
      if (session != null && session.startReported && _allowed) {
        _events.sessionEnded(durationSeconds: session.foregroundMs ~/ 1000);
      }
      _state.session = _Session(id: _newSessionId());
    }
    _foregroundSince = now;

    _reportPending();
    if (_allowed) {
      if (updatedFrom != null) {
        _events.appUpdated(previousVersion: updatedFrom.version, previousBuild: updatedFrom.build);
      }
      _events.appOpened(coldStart: coldStart);
    }

    await _save();
  }

  // Install and session start that happened before consent
  void _reportPending() {
    if (!_allowed) return;
    if (_state.installPending) {
      _events.appInstalled();
      _state.installPending = false;
    }
    final session = _state.session;
    if (session != null && !session.startReported) {
      _events.sessionStarted();
      session.startReported = true;
    }
  }

  void _onConsentChanged() {
    if (!_allowed) return;
    _reportPending();
    unawaited(_save());
  }

  Future<_UsageState> _load() async {
    try {
      final raw = await _store.read(_key);
      if (raw == null) return _UsageState();
      final json = jsonDecode(raw);
      return json is Map<String, Object?> ? _UsageState.fromJson(json) : _UsageState();
    } on FormatException {
      return _UsageState();
    }
  }

  Future<void> _save() async {
    try {
      await _store.write(_key, jsonEncode(_state.toJson()));
    } catch (_) {
      // Losing the session state costs at most one extra session start
    }
  }
}

class _Session {
  _Session({
    required this.id,
    this.foregroundMs = 0,
    this.backgroundAt,
    this.startReported = false,
  });

  final String id;
  int foregroundMs;

  /// Set while the app is in the background
  DateTime? backgroundAt;

  /// session_started was recorded (it waits for analytics consent)
  bool startReported;
}

class _UsageState {
  _UsageState();

  factory _UsageState.fromJson(Map<String, Object?> json) {
    final rawSession = json['session'];
    final state = _UsageState()
      ..appVersion = readOptionalString(json, 'appVersion')
      ..appBuild = readOptionalString(json, 'appBuild')
      ..installPending = readBool(json, 'installPending');

    if (rawSession != null) {
      final session = readObject(rawSession);
      final backgroundAt = session['backgroundAt'];
      state.session = _Session(
        id: readString(session, 'id'),
        foregroundMs: readInt(session, 'foregroundMs'),
        backgroundAt: backgroundAt == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(readInt(session, 'backgroundAt'), isUtc: true),
        startReported: readBool(session, 'startReported'),
      );
    }
    return state;
  }

  String? appVersion;
  String? appBuild;

  /// app_installed was not recorded yet (it waits for analytics consent)
  bool installPending = false;
  _Session? session;

  Map<String, Object?> toJson() => {
        'appVersion': appVersion,
        'appBuild': appBuild,
        'installPending': installPending,
        'session': switch (session) {
          null => null,
          final s => {
              'id': s.id,
              'foregroundMs': s.foregroundMs,
              'backgroundAt': s.backgroundAt?.millisecondsSinceEpoch,
              'startReported': s.startReported,
            },
        },
      };
}