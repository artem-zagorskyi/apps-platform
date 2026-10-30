import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/models.dart';
import '../api/platform_api.dart';
import '../consent/consent_manager.dart';
import '../errors.dart';
import '../events/platform_events.g.dart';
import '../session/session_manager.dart';
import '../storage/session_store.dart';
import 'config_source.dart';

/// Remote config of the current user.
///
/// Values come from the config of this launch: on the first launch the SDK
/// waits briefly for the server, later the config fetched in the background
/// during the previous launch applies. After a user change the new user's
/// config applies as soon as it arrives. Listeners are notified whenever the
/// values in use change.
///
/// Generated config classes read through it: `AppConfig(platform.config)`.
class ConfigManager extends ChangeNotifier implements ConfigSource {
  ConfigManager({
    required this._session,
    required this._api,
    required this._store,
    required this._client,
    required this._events,
    required this._consent,
    String? Function()? sessionId,
    DateTime Function()? clock,
    this.firstLaunchWait = const Duration(milliseconds: 1500),
    String keyPrefix = 'app_platform',
  })  : _sessionId = sessionId ?? (() => null),
        _clock = clock ?? DateTime.now,
        _key = '$keyPrefix.config';

  /// Back from the background after this long: fetch again
  static const refreshAfter = Duration(hours: 1);

  final SessionManager _session;
  final PlatformApi _api;
  final KeyValueStore _store;
  final ClientInfo _client;
  final PlatformEvents _events;
  final ValueListenable<ConsentState> _consent;
  final String? Function() _sessionId;
  final DateTime Function() _clock;
  final String _key;

  /// How long the first launch waits for the server before using defaults
  final Duration firstLaunchWait;

  _ConfigState _state = _ConfigState();
  ConfigValues _values = ConfigValues.empty;
  StreamSubscription<UserChange>? _userChanges;
  Future<void>? _fetching;
  // Grows on every user change: answers started before belong to the previous user
  int _generation = 0;
  bool _disposed = false;

  // Exposures recorded in the current session: "experiment|variant"
  final Set<String> _exposed = {};
  String? _exposureSession;

  /// Version of the config in use; 0 before any arrived
  int get version => _state.active?.config.version ?? 0;

  /// Experiments the user is in, in the config in use
  List<ConfigExperiment> get experiments => _state.active?.config.experiments ?? const [];

  /// A newer config was fetched and waits for the next launch or [activate]
  bool get hasPending => _state.pending != null;

  /// When the server was last asked successfully
  DateTime? get fetchedAt => _state.fetchedAt;

  /// Raw values in use, for debug screens
  Map<String, Object?> get rawValues => _state.active?.config.values ?? const {};

  /// Called by the SDK at start-up, after the session started
  Future<void> start() async {
    _state = await _load();
    final firstLaunch = _state.isEmpty;

    // The config fetched during the previous launch applies now
    final pending = _state.pending;
    if (pending != null) {
      _state
        ..active = pending
        ..pending = null;
    }
    // Fetched for another user (the session changed while the app was closed)
    final active = _state.active;
    if (active != null && active.userId != _session.userId) _state = _ConfigState();
    _apply();
    await _save();

    _userChanges = _session.userChanges.listen(_onUserChange);

    if (firstLaunch) {
      // Onboarding experiments need the config before the first screen
      var waiting = true;
      await _refresh(applyNow: () => waiting).timeout(firstLaunchWait, onTimeout: () {});
      // A later answer waits for the next launch
      waiting = false;
    } else {
      unawaited(_refresh());
    }
  }

  /// The app came back from the background
  void onForeground() {
    final fetchedAt = _state.fetchedAt;
    if (fetchedAt == null || _clock().difference(fetchedAt) >= refreshAfter) {
      unawaited(_refresh());
    }
  }

  /// Fetches the latest config now. It applies at the next launch or with
  /// [activate]. Throws NetworkException / ServerException while offline.
  Future<void> fetch() => _startFetch(() => false);

  /// Applies a config fetched in the background now instead of at the next
  /// launch, e.g. for an urgent kill switch
  Future<void> activate() async {
    final pending = _state.pending;
    if (pending == null) return;
    _state
      ..active = pending
      ..pending = null;
    _apply();
    _notify();
    await _save();
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(_userChanges?.cancel());
    super.dispose();
  }

  @override
  bool readBool(String name, {required bool defaultValue}) =>
      _read(name, _values.readBool(name, defaultValue: defaultValue));

  @override
  int readInt(String name, {required int defaultValue, int? min, int? max}) =>
      _read(name, _values.readInt(name, defaultValue: defaultValue, min: min, max: max));

  @override
  double readNumber(String name, {required double defaultValue, double? min, double? max}) =>
      _read(name, _values.readNumber(name, defaultValue: defaultValue, min: min, max: max));

  @override
  String readString(String name, {required String defaultValue, required int maxLength}) =>
      _read(name, _values.readString(name, defaultValue: defaultValue, maxLength: maxLength));

  @override
  String readEnum(String name, {required String defaultValue, required List<String> values}) =>
      _read(name, _values.readEnum(name, defaultValue: defaultValue, values: values));

  T _read<T>(String name, T value) {
    // The user sees the server value only if this app version can use it
    // (2 == 2.0 in Dart, so numbers from JSON compare fine)
    if (_values[name] == value) _recordExposure(name);
    return value;
  }

  void _recordExposure(String parameter) {
    final active = _state.active;
    if (active == null) return;

    for (final experiment in active.config.experiments) {
      if (experiment.forced || !experiment.parameters.contains(parameter)) continue;
      // Not marked without consent: a later read in this session records it
      if (!_consent.value.analytics) return;

      final session = _sessionId();
      if (session != _exposureSession) {
        _exposureSession = session;
        _exposed.clear();
      }
      if (_exposed.add('${experiment.key}|${experiment.variant}')) {
        _events.experimentExposed(
          experiment: experiment.key,
          variant: experiment.variant,
          configVersion: active.config.version,
        );
      }
    }
  }

  // Another user owns the device: drop the previous user's config at once
  void _onUserChange(UserChange change) {
    _generation++;
    _fetching = null;
    _state = _ConfigState();
    _exposed.clear();
    _apply();
    _notify();
    unawaited(_save());
    unawaited(_refresh(applyNow: () => true));
  }

  // Like fetch, but failures are ignored: the next trigger retries
  Future<void> _refresh({bool Function()? applyNow}) async {
    try {
      await _startFetch(applyNow ?? () => false);
    } on AppPlatformException {
      // Offline or the server is unavailable
    }
  }

  // One request at a time; a user change starts a new one
  Future<void> _startFetch(bool Function() applyNow) {
    final running = _fetching;
    if (running != null) return running;

    final future = _fetchOnce(_generation, applyNow);
    _fetching = future;
    void clear() {
      if (identical(_fetching, future)) _fetching = null;
    }

    unawaited(future.then((_) => clear(), onError: (Object _) => clear()));
    return future;
  }

  Future<void> _fetchOnce(int generation, bool Function() applyNow) async {
    final etag = _state.etag;
    final response = await _session.authorized(
      (token) => _api.getConfig(token, appVersion: _client.appVersion, etag: etag),
    );

    final userId = _session.userId;
    // The device switched users meanwhile: the answer belongs to the previous one
    if (_disposed || generation != _generation || userId == null) return;

    _state.fetchedAt = _clock();
    // null: 304, the config did not change
    if (response != null) {
      final snapshot = _Snapshot(userId: userId, config: response.config);
      _state.etag = response.etag;
      if (applyNow()) {
        _state
          ..active = snapshot
          ..pending = null;
        _apply();
        _notify();
      } else {
        _state.pending = snapshot;
      }
    }
    await _save();
  }

  void _apply() {
    _values = ConfigValues(_state.active?.config.values ?? const {});
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<_ConfigState> _load() async {
    try {
      final raw = await _store.read(_key);
      if (raw == null) return _ConfigState();
      final json = jsonDecode(raw);
      return json is Map<String, Object?> ? _ConfigState.fromJson(json) : _ConfigState();
    } catch (_) {
      // Unreadable: start over with the built-in defaults
      return _ConfigState();
    }
  }

  Future<void> _save() async {
    try {
      await _store.write(_key, jsonEncode(_state.toJson()));
    } catch (_) {
      // Losing it costs one more request and defaults until it arrives
    }
  }
}

class _Snapshot {
  const _Snapshot({required this.userId, required this.config});

  factory _Snapshot.fromJson(Map<String, Object?> json) =>
      _Snapshot(userId: readString(json, 'userId'), config: ServerConfig.fromJson(json));

  final String userId;
  final ServerConfig config;

  Map<String, Object?> toJson() => {'userId': userId, ...config.toJson()};
}

class _ConfigState {
  _ConfigState();

  factory _ConfigState.fromJson(Map<String, Object?> json) {
    _Snapshot? snapshot(Object? raw) => raw == null ? null : _Snapshot.fromJson(readObject(raw));
    final fetchedAt = json['fetchedAt'];
    return _ConfigState()
      ..active = snapshot(json['active'])
      ..pending = snapshot(json['pending'])
      ..etag = readOptionalString(json, 'etag')
      ..fetchedAt = fetchedAt is int ? DateTime.fromMillisecondsSinceEpoch(fetchedAt, isUtc: true) : null;
  }

  /// In use during this launch
  _Snapshot? active;

  /// Fetched in the background; becomes active at the next launch
  _Snapshot? pending;

  /// Of the newest fetched config, for If-None-Match
  String? etag;
  DateTime? fetchedAt;

  /// Nothing was ever fetched: a first launch
  bool get isEmpty => active == null && pending == null && fetchedAt == null;

  Map<String, Object?> toJson() => {
        'active': active?.toJson(),
        'pending': pending?.toJson(),
        'etag': etag,
        'fetchedAt': fetchedAt?.millisecondsSinceEpoch,
      };
}