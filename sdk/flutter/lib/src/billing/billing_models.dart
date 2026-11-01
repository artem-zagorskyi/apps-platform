import 'package:flutter/foundation.dart';

/// App store a purchase was made in
enum BillingStore {
  googlePlay('google_play'),
  appStore('app_store');

  const BillingStore(this.wireName);

  final String wireName;

  static BillingStore fromWire(String value) => values.firstWhere(
        (s) => s.wireName == value,
        orElse: () => throw FormatException('Unknown store "$value"'),
      );
}

/// Access the user has, e.g. premium, granted by a purchase
@immutable
class Entitlement {
  const Entitlement({
    required this.key,
    required this.productId,
    required this.store,
    required this.state,
    required this.expiresAt,
    required this.willRenew,
  });

  factory Entitlement.fromJson(Map<String, Object?> json) => Entitlement(
        key: _readString(json, 'key'),
        productId: _readString(json, 'productId'),
        store: BillingStore.fromWire(_readString(json, 'store')),
        state: _readString(json, 'state'),
        expiresAt: switch (json['expiresAt']) {
          null => null,
          final String value => DateTime.parse(value),
          _ => throw const FormatException('Expected string "expiresAt"'),
        },
        willRenew: switch (json['willRenew']) {
          final bool value => value,
          _ => throw const FormatException('Expected bool "willRenew"'),
        },
      );

  static List<Entitlement> listFromJson(Object? value) {
    if (value is! List<Object?>) throw const FormatException('Expected list of entitlements');
    return [
      for (final item in value)
        if (item is Map<String, Object?>)
          Entitlement.fromJson(item)
        else
          throw const FormatException('Expected entitlement object'),
    ];
  }

  final String key;
  final String productId;
  final BillingStore store;

  /// Purchase state as the server reports it, e.g. active, canceled
  /// (paid until expiry) or grace_period (the store retries a payment)
  final String state;

  /// End of the paid period; null for purchases that never expire
  final DateTime? expiresAt;

  /// The subscription renews by itself at [expiresAt]
  final bool willRenew;

  /// On the device an entitlement lasts until three days after its end:
  /// a renewal may not have reached the device yet (no network)
  bool grantsAt(DateTime time) {
    final end = expiresAt;
    return end == null || time.isBefore(end.add(Entitlements.offlineGrace));
  }

  Map<String, Object?> toJson() => {
        'key': key,
        'productId': productId,
        'store': store.wireName,
        'state': state,
        'expiresAt': expiresAt?.toUtc().toIso8601String(),
        'willRenew': willRenew,
      };
}

/// What the current user has access to
@immutable
class Entitlements {
  const Entitlements(this.all);

  static const empty = Entitlements(<Entitlement>[]);

  /// How long past its end an entitlement still counts on the device
  static const offlineGrace = Duration(days: 3);

  final List<Entitlement> all;

  /// `entitlements.has('premium')`
  bool has(String key, {DateTime? now}) => active(key, now: now) != null;

  /// The entitlement with this key if it still grants access
  Entitlement? active(String key, {DateTime? now}) {
    final time = now ?? DateTime.now();
    for (final e in all) {
      if (e.key == key && e.grantsAt(time)) return e;
    }
    return null;
  }
}

/// How the server handled a purchase sent from this device
enum RegistrationStatus {
  owned('owned'),
  transferred('transferred'),
  signInRequired('sign_in_required'),
  ownedByOtherAccount('owned_by_other_account');

  const RegistrationStatus(this.wireName);

  final String wireName;

  static RegistrationStatus fromWire(String value) => values.firstWhere(
        (s) => s.wireName == value,
        orElse: () => throw FormatException('Unknown registration status "$value"'),
      );
}

@immutable
class PurchaseRegistration {
  const PurchaseRegistration({
    required this.status,
    required this.maskedEmail,
    required this.entitlements,
  });

  factory PurchaseRegistration.fromJson(Map<String, Object?> json) => PurchaseRegistration(
        status: RegistrationStatus.fromWire(_readString(json, 'status')),
        maskedEmail: switch (json['maskedEmail']) {
          null => null,
          final String value => value,
          _ => throw const FormatException('Expected string "maskedEmail"'),
        },
        entitlements: Entitlement.listFromJson(json['entitlements']),
      );

  final RegistrationStatus status;

  /// For signInRequired: the owner's email, e.g. a***@gmail.com
  final String? maskedEmail;

  /// Of the current user, after this purchase
  final List<Entitlement> entitlements;
}

String _readString(Map<String, Object?> json, String key) => switch (json[key]) {
      final String value => value,
      _ => throw FormatException('Expected string "$key"'),
    };