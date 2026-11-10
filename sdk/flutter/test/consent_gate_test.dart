import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/api/models.dart';
import 'package:renvix_sdk/src/billing/billing_models.dart';
import 'package:renvix_sdk/src/consent/consent_gate.dart';
import 'package:renvix_sdk/src/consent/consent_manager.dart';

final _now = DateTime.utc(2026, 11, 10, 12);

ConsentState _consent({
  ConsentStatus status = ConsentStatus.decided,
  bool analytics = false,
  bool personalization = false,
  String? payEntitlement,
}) =>
    ConsentState(
      status: status,
      analytics: analytics,
      personalization: personalization,
      canAskAgainAt: null,
      policyVersion: 'v1',
      payEntitlement: payEntitlement,
    );

Entitlements _granting(String key, {DateTime? expiresAt}) => Entitlements([
      Entitlement(
        key: key,
        productId: 'premium_monthly',
        store: BillingStore.googlePlay,
        state: 'active',
        expiresAt: expiresAt ?? _now.add(const Duration(days: 10)),
        willRenew: true,
      ),
    ]);

ConsentGate _gate(ConsentState consent, [Entitlements entitlements = Entitlements.empty]) =>
    ConsentGateWatcher.evaluate(consent, entitlements, _now);

void main() {
  test('optional: asks once and opens after any decision', () {
    expect(_gate(_consent(status: ConsentStatus.needsDecision)), ConsentGate.askConsent);
    expect(_gate(_consent()), ConsentGate.open);
    expect(_gate(_consent(status: ConsentStatus.notRequired)), ConsentGate.open);
  });

  test('consent_or_pay: opens only with consent to both purposes', () {
    ConsentState state({ConsentStatus status = ConsentStatus.decided, bool a = false, bool p = false}) =>
        _consent(status: status, analytics: a, personalization: p, payEntitlement: 'ad_free');

    expect(_gate(state(status: ConsentStatus.needsDecision)), ConsentGate.consentOrPay);
    expect(_gate(state()), ConsentGate.consentOrPay);
    expect(_gate(state(a: true)), ConsentGate.consentOrPay);
    expect(_gate(state(a: true, p: true)), ConsentGate.open);
    // A new policy version: the earlier grant no longer opens the app
    expect(_gate(state(status: ConsentStatus.needsDecision, a: true, p: true)), ConsentGate.consentOrPay);
  });

  test('consent_or_pay: the entitlement of the policy replaces consent', () {
    final refused = _consent(payEntitlement: 'ad_free');

    expect(_gate(refused, _granting('ad_free')), ConsentGate.open);
    expect(_gate(refused, _granting('premium')), ConsentGate.consentOrPay);
    // Past the offline grace of three days
    final expired = _granting('ad_free', expiresAt: _now.subtract(const Duration(days: 4)));
    expect(_gate(refused, expired), ConsentGate.consentOrPay);
  });

  test('follows consent and entitlements', () {
    final consent = ValueNotifier(_consent(payEntitlement: 'ad_free'));
    final entitlements = ValueNotifier(Entitlements.empty);
    final watcher = ConsentGateWatcher(consent: consent, entitlements: entitlements, clock: () => _now);
    addTearDown(watcher.dispose);

    expect(watcher.gate.value, ConsentGate.consentOrPay);
    entitlements.value = _granting('ad_free');
    expect(watcher.gate.value, ConsentGate.open);
    entitlements.value = Entitlements.empty;
    consent.value = _consent(analytics: true, personalization: true, payEntitlement: 'ad_free');
    expect(watcher.gate.value, ConsentGate.open);
  });

  test('reads payEntitlement from the server policy', () {
    ServerConsentState parse(Map<String, Object?> policy) => ServerConsentState.fromJson({
          'policy': {'region': '*', 'version': 'v1', ...policy},
          'decisions': <Object?>[],
          'canAskAgainAt': null,
        });

    expect(parse({'mode': 'consent_or_pay', 'payEntitlement': 'ad_free'}).payEntitlement, 'ad_free');
    // Servers without the field
    expect(parse({'mode': 'optional'}).payEntitlement, isNull);
  });
}