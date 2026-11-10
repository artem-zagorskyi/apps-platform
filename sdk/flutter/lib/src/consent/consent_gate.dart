import 'package:flutter/foundation.dart';

import '../billing/billing_models.dart';
import 'consent_manager.dart';

/// What the app shows before letting the person in.
enum ConsentGate {
  /// Use the app
  open,

  /// Show the consent screen; the app works after a refusal
  askConsent,

  /// consent_or_pay: show "agree or buy". The app opens with consent to
  /// both purposes, or with the entitlement of the policy.
  consentOrPay,
}

/// Combines consent and entitlements into one answer for the app.
class ConsentGateWatcher {
  ConsentGateWatcher({
    required this._consent,
    required this._entitlements,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now {
    _consent.addListener(refresh);
    _entitlements.addListener(refresh);
  }

  final ValueListenable<ConsentState> _consent;
  final ValueListenable<Entitlements> _entitlements;
  final DateTime Function() _clock;

  late final ValueNotifier<ConsentGate> _gate = ValueNotifier(_current());

  ValueListenable<ConsentGate> get gate => _gate;

  /// Also called when the app returns to the foreground: an entitlement
  /// may have run out meanwhile
  void refresh() {
    _gate.value = _current();
  }

  void dispose() {
    _consent.removeListener(refresh);
    _entitlements.removeListener(refresh);
    _gate.dispose();
  }

  ConsentGate _current() => evaluate(_consent.value, _entitlements.value, _clock());

  static ConsentGate evaluate(ConsentState consent, Entitlements entitlements, DateTime now) {
    if (consent.status == ConsentStatus.notRequired) return ConsentGate.open;

    final payEntitlement = consent.payEntitlement;
    if (payEntitlement == null) {
      return consent.status == ConsentStatus.needsDecision ? ConsentGate.askConsent : ConsentGate.open;
    }

    // Paid: no consent is asked, analytics and personalization stay off
    if (entitlements.has(payEntitlement, now: now)) return ConsentGate.open;

    final agreed =
        consent.status == ConsentStatus.decided && consent.analytics && consent.personalization;
    return agreed ? ConsentGate.open : ConsentGate.consentOrPay;
  }
}