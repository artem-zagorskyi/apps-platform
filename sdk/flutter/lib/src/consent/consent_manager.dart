import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/models.dart';
import '../api/platform_api.dart';
import '../errors.dart';
import '../session/session_manager.dart';
import 'consent_store.dart';

enum ConsentStatus {
  /// Show the consent screen
  needsDecision,

  /// The person decided for the current policy
  decided,

  /// No consent screen for this region; analytics is on unless switched off
  notRequired,
}

/// What the app may do right now.
@immutable
class ConsentState {
  const ConsentState({
    required this.status,
    required this.analytics,
    required this.personalization,
    required this.canAskAgainAt,
    required this.policyVersion,
  });

  static const initial = ConsentState(
    status: ConsentStatus.needsDecision,
    analytics: false,
    personalization: false,
    canAskAgainAt: null,
    policyVersion: null,
  );

  final ConsentStatus status;

  /// Analytics events and device details may be collected
  final bool analytics;

  /// Content and offers may be tailored to the person
  final bool personalization;

  /// After a refusal: the app may ask again from this time on
  final DateTime? canAskAgainAt;

  /// Current policy version; null until the server has answered once
  final String? policyVersion;
}

/// Consent decisions: recorded on the device first, sent to the server
/// when possible, reset when another user takes over the device.
class ConsentManager {
  ConsentManager({
    required this._session,
    required this._api,
    required this._store,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final SessionManager _session;
  final PlatformApi _api;
  final ConsentStore _store;
  final DateTime Function() _clock;

  final ValueNotifier<ConsentState> _state = ValueNotifier(ConsentState.initial);
  LocalConsent _local = LocalConsent.empty;
  StreamSubscription<UserChange>? _userChanges;
  Future<void>? _syncing;

  /// Current state; listen to rebuild the UI on changes
  ValueListenable<ConsentState> get state => _state;

  /// Decisions recorded on the device and not sent yet
  bool get hasPendingDecisions => _local.pending.isNotEmpty;

  /// Loads stored decisions. Called by the SDK at start-up.
  Future<void> load() async {
    _local = await _store.read();

    // Decisions stored for someone else (e.g. a crash during a user switch)
    final owner = _local.ownerUserId;
    final userId = _session.userId;
    if (owner != null && userId != null && owner != userId) {
      _local = LocalConsent(mode: _local.mode, policyVersion: _local.policyVersion);
      await _store.write(_local);
    }

    _publish();
    _userChanges ??= _session.userChanges.listen((change) => unawaited(_onUserChange(change)));
  }

  /// Records the person's choice. It applies immediately, also offline,
  /// and is sent to the server when possible.
  Future<void> record({
    bool? analytics,
    bool? personalization,
    required ConsentSource source,
  }) async {
    // "?value" adds the entry only when the value is not null
    final decisions = <ConsentPurpose, bool>{
      ConsentPurpose.analytics: ?analytics,
      ConsentPurpose.personalization: ?personalization,
    };
    if (decisions.isEmpty) throw ArgumentError('At least one decision is required');

    final now = _clock();
    final userId = _session.userId;

    _local = LocalConsent(
      ownerUserId: _local.ownerUserId ?? userId,
      mode: _local.mode,
      policyVersion: _local.policyVersion,
      decisions: {
        ..._local.decisions,
        for (final entry in decisions.entries)
          entry.key: ConsentDecision(
            granted: entry.value,
            policyVersion: _local.policyVersion ?? '',
            decidedAt: now,
          ),
      },
      canAskAgainAt: _local.canAskAgainAt,
      pending: [
        ..._local.pending,
        PendingConsent(
          ownerUserId: userId,
          decisions: decisions,
          policyVersion: _local.policyVersion,
          source: source,
          decidedAt: now,
        ),
      ],
    );

    // Persisted first: the choice holds even if the app dies right now
    await _store.write(_local);
    _publish();
    unawaited(trySync());
  }

  /// Sends pending decisions and loads the server state.
  /// Throws NetworkException / ServerException while the server is unreachable.
  Future<void> sync() {
    return _syncing ??= _syncOnce().whenComplete(() {
      _syncing = null;
    });
  }

  /// Like [sync], but failures are ignored: it is retried at the next
  /// start-up, decision or user change.
  Future<void> trySync() async {
    try {
      await sync();
    } on AppPlatformException {
      // Offline or the server is unavailable
    }
  }

  Future<void> dispose() async {
    await _userChanges?.cancel();
    _state.dispose();
  }

  Future<void> _syncOnce() async {
    // Creates the user first if the device has none yet (first launch offline)
    await _session.accessToken();
    final userId = _session.userId;

    var server = await _session.authorized(_api.getConsent);

    // Oldest first, re-read on every pass: decisions made meanwhile are sent too
    while (true) {
      final next = _local.pending.firstOrNull;
      if (next == null) break;

      if (next.ownerUserId == null || next.ownerUserId == userId) {
        // Decided before the policy was known: the current policy applies
        final policyVersion = next.policyVersion ?? server.policyVersion;
        final sentAt = _clock();
        server = await _session.authorized(
          (token) => _api.recordConsent(
            token,
            decisions: next.decisions,
            policyVersion: policyVersion,
            source: next.source,
            decidedAt: next.decidedAt,
            sentAt: sentAt,
          ),
        );
      }
      // Sent, or made by a previous user who can no longer be authenticated
      _local = _local.withoutPending(next);
      await _store.write(_local);
    }

    // The device switched users meanwhile: the new user syncs on its own
    if (_session.userId != userId) return;

    // Everything is sent: the server state is the truth
    _local = LocalConsent(
      ownerUserId: userId,
      mode: server.mode,
      policyVersion: server.policyVersion,
      decisions: server.decisions,
      canAskAgainAt: server.canAskAgainAt,
    );
    await _store.write(_local);
    _publish();
  }

  Future<void> _onUserChange(UserChange change) async {
    // Decisions made before the first user existed belong to that user.
    // After a reset, logout or merge the new user's own decisions apply;
    // without any, the person is asked.
    final adopt = change.reason == UserChangeReason.signedUp && _local.ownerUserId == null;

    _local = adopt
        ? LocalConsent(
            ownerUserId: change.userId,
            mode: _local.mode,
            policyVersion: _local.policyVersion,
            decisions: _local.decisions,
            canAskAgainAt: _local.canAskAgainAt,
            pending: _local.pending,
          )
        : LocalConsent(mode: _local.mode, policyVersion: _local.policyVersion);

    await _store.write(_local);
    _publish();
    await trySync();
  }

  void _publish() {
    _state.value = _evaluate(_local);
  }

  // Same rules as the server, so the state is right offline too
  static ConsentState _evaluate(LocalConsent local) {
    final mode = local.mode;
    final version = local.policyVersion;

    bool allowed(ConsentPurpose purpose) {
      final decision = local.decisions[purpose];
      // Without a decision only a region without a consent screen allows it
      return decision?.granted ?? mode == ConsentMode.none;
    }

    bool decidedForCurrentPolicy(ConsentPurpose purpose) {
      final decision = local.decisions[purpose];
      if (decision == null) return false;
      // An empty version: decided before the policy was known, sent with the current one
      return version == null || decision.policyVersion.isEmpty || decision.policyVersion == version;
    }

    final ConsentStatus status;
    if (mode == ConsentMode.none) {
      status = ConsentStatus.notRequired;
    } else if (ConsentPurpose.values.every(decidedForCurrentPolicy)) {
      status = ConsentStatus.decided;
    } else {
      // Unknown policy (never reached the server) is treated as "ask"
      status = ConsentStatus.needsDecision;
    }

    return ConsentState(
      status: status,
      analytics: allowed(ConsentPurpose.analytics),
      personalization: allowed(ConsentPurpose.personalization),
      canAskAgainAt: local.canAskAgainAt,
      policyVersion: version,
    );
  }
}