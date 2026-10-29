import 'dart:convert';

import '../api/models.dart';
import '../storage/session_store.dart';

/// A decision made on the device and not sent to the server yet.
class PendingConsent {
  const PendingConsent({
    required this.ownerUserId,
    required this.decisions,
    required this.policyVersion,
    required this.source,
    required this.decidedAt,
  });

  /// Null: made before the device had a user (first launch offline)
  final String? ownerUserId;
  final Map<ConsentPurpose, bool> decisions;

  /// Null: the policy was not known yet; the current one applies when sending
  final String? policyVersion;
  final ConsentSource source;
  final DateTime decidedAt;
}

/// Everything the SDK keeps about consent on the device.
class LocalConsent {
  const LocalConsent({
    this.ownerUserId,
    this.mode,
    this.policyVersion,
    this.decisions = const {},
    this.canAskAgainAt,
    this.pending = const [],
  });

  static const empty = LocalConsent();

  /// The user the decisions belong to; null before the first user exists
  final String? ownerUserId;

  /// Last policy known from the server; null until the first answer
  final ConsentMode? mode;
  final String? policyVersion;

  /// Latest decision per purpose, from the server or made on the device
  final Map<ConsentPurpose, ConsentDecision> decisions;
  final DateTime? canAskAgainAt;
  final List<PendingConsent> pending;

  LocalConsent withoutPending(PendingConsent sent) {
    return LocalConsent(
      ownerUserId: ownerUserId,
      mode: mode,
      policyVersion: policyVersion,
      decisions: decisions,
      canAskAgainAt: canAskAgainAt,
      pending: [for (final item in pending) if (!identical(item, sent)) item],
    );
  }
}

/// Persists LocalConsent as one value in the SDK storage.
class ConsentStore {
  ConsentStore(this._store, {String keyPrefix = 'app_platform'})
      : _key = '$keyPrefix.consent';

  final KeyValueStore _store;
  final String _key;

  /// Empty if nothing is stored or the stored value is unreadable
  Future<LocalConsent> read() async {
    final raw = await _store.read(_key);
    if (raw == null) return LocalConsent.empty;

    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, Object?>) return LocalConsent.empty;
      return _fromJson(json);
    } on FormatException {
      return LocalConsent.empty;
    }
  }

  Future<void> write(LocalConsent consent) => _store.write(_key, jsonEncode(_toJson(consent)));

  static Map<String, Object?> _toJson(LocalConsent c) => {
        'ownerUserId': c.ownerUserId,
        'mode': c.mode?.wireName,
        'policyVersion': c.policyVersion,
        'decisions': {
          for (final entry in c.decisions.entries)
            entry.key.name: {
              'granted': entry.value.granted,
              'policyVersion': entry.value.policyVersion,
              'decidedAt': entry.value.decidedAt.toUtc().toIso8601String(),
            },
        },
        'canAskAgainAt': c.canAskAgainAt?.toUtc().toIso8601String(),
        'pending': [
          for (final p in c.pending)
            {
              'ownerUserId': p.ownerUserId,
              'decisions': {for (final e in p.decisions.entries) e.key.name: e.value},
              'policyVersion': p.policyVersion,
              'source': p.source.wireName,
              'decidedAt': p.decidedAt.toUtc().toIso8601String(),
            },
        ],
      };

  static LocalConsent _fromJson(Map<String, Object?> json) {
    final decisions = <ConsentPurpose, ConsentDecision>{};
    for (final entry in readObject(json['decisions']).entries) {
      final purpose = _purpose(entry.key);
      if (purpose == null) continue;
      final value = readObject(entry.value);
      decisions[purpose] = ConsentDecision(
        granted: readBool(value, 'granted'),
        policyVersion: readString(value, 'policyVersion'),
        decidedAt: readDateTime(value, 'decidedAt'),
      );
    }

    final rawPending = json['pending'];
    if (rawPending is! List<Object?>) throw const FormatException('Expected list "pending"');

    return LocalConsent(
      ownerUserId: readOptionalString(json, 'ownerUserId'),
      mode: json['mode'] == null
          ? null
          : readWireEnum(ConsentMode.values, (m) => m.wireName, json, 'mode'),
      policyVersion: readOptionalString(json, 'policyVersion'),
      decisions: decisions,
      canAskAgainAt: json['canAskAgainAt'] == null ? null : readDateTime(json, 'canAskAgainAt'),
      pending: [for (final item in rawPending) _pendingFromJson(readObject(item))],
    );
  }

  static PendingConsent _pendingFromJson(Map<String, Object?> json) {
    final decisions = <ConsentPurpose, bool>{};
    for (final entry in readObject(json['decisions']).entries) {
      final purpose = _purpose(entry.key);
      final granted = entry.value;
      if (purpose != null && granted is bool) decisions[purpose] = granted;
    }

    return PendingConsent(
      ownerUserId: readOptionalString(json, 'ownerUserId'),
      decisions: decisions,
      policyVersion: readOptionalString(json, 'policyVersion'),
      source: readWireEnum(ConsentSource.values, (s) => s.wireName, json, 'source'),
      decidedAt: readDateTime(json, 'decidedAt'),
    );
  }

  static ConsentPurpose? _purpose(String name) =>
      ConsentPurpose.values.where((p) => p.name == name).firstOrNull;
}