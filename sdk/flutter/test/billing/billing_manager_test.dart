import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/billing/billing_manager.dart';
import 'package:renvix_sdk/src/billing/billing_models.dart';
import 'package:renvix_sdk/src/billing/store_client.dart';
import 'package:renvix_sdk/src/errors.dart';
import 'package:renvix_sdk/src/events/event_tracker.dart';
import 'package:renvix_sdk/src/events/platform_events.g.dart';
import 'package:renvix_sdk/src/session/session_manager.dart';
import 'package:renvix_sdk/src/storage/session_store.dart';

import '../support/fake_api.dart';
import '../support/fake_store_client.dart';

Future<void> _settle() => Future<void>.delayed(const Duration(milliseconds: 50));

void main() {
  late DateTime now;
  late FakeApi api;
  late FakeStoreClient store;
  late InMemoryKeyValueStore storage;
  late SessionManager session;

  setUp(() async {
    now = DateTime.utc(2026, 11, 1, 12);
    api = FakeApi(() => now);
    store = FakeStoreClient();
    storage = InMemoryKeyValueStore();
    session = SessionManager(
      api: api,
      store: SessionStore(storage),
      client: testClient,
      clock: () => now,
      newInstallationId: () => 'install-1',
    );
    await session.start(); // user-1
  });

  Future<BillingManager> started() async {
    final billing = BillingManager(
      session: session,
      api: api,
      store: store,
      storage: storage,
      clock: () => now,
    );
    await billing.start();
    await _settle();
    return billing;
  }

  bool hasPremium(BillingManager billing) => billing.entitlements.value.has('premium', now: now);

  group('entitlements', () {
    test('are fetched at start and kept for a launch without a network', () async {
      api.setServerEntitlements('user-1', [premiumUntil(now.add(const Duration(days: 30)))]);
      final first = await started();
      expect(hasPremium(first), isTrue);
      await first.dispose();

      api.billingFailure = const NetworkException('offline');
      final next = BillingManager(session: session, api: api, store: store, storage: storage);
      await next.start();

      // From the cache, right after start
      expect(hasPremium(next), isTrue);
      await next.dispose();
    });

    test('last until three days after their end on the device', () {
      final entitlements = Entitlements([premiumUntil(now)]);

      expect(entitlements.has('premium', now: now.add(const Duration(days: 2))), isTrue);
      expect(entitlements.has('premium', now: now.add(const Duration(days: 4))), isFalse);
    });

    test('are fetched again on return to the app only after an hour', () async {
      final billing = await started();
      final requests = api.entitlementRequests;

      now = now.add(const Duration(minutes: 30));
      billing.onForeground();
      await _settle();
      expect(api.entitlementRequests, requests);

      now = now.add(const Duration(minutes: 31));
      billing.onForeground();
      await _settle();
      expect(api.entitlementRequests, requests + 1);
      await billing.dispose();
    });

    test('of the previous user are dropped on a user change', () async {
      api.setServerEntitlements('user-1', [premiumUntil(now.add(const Duration(days: 30)))]);
      final billing = await started();
      expect(hasPremium(billing), isTrue);

      await session.deleteAccount(); // user-2 has nothing
      await _settle();

      expect(hasPremium(billing), isFalse);
      await billing.dispose();
    });

    test('an answer for the previous user is discarded', () async {
      final billing = await started();
      api.setServerEntitlements('user-1', [premiumUntil(now.add(const Duration(days: 30)))]);
      final hold = Completer<void>();
      api.onGetEntitlements = () => hold.future;

      final refreshing = billing.refresh();
      await _settle();
      api.onGetEntitlements = null;
      await session.deleteAccount();
      await _settle();
      hold.complete();
      await refreshing;
      await _settle();

      expect(hasPremium(billing), isFalse);
      await billing.dispose();
    });
  });

  group('purchase', () {
    test('is registered with the user id, completed and grants access', () async {
      final billing = await started();
      store.onBuy = (p) => paid('token-1');

      final result = await billing.purchase(premiumProduct, offer: premiumProduct.offers.first);

      expect(result.outcome, PurchaseOutcome.purchased);
      expect(store.bought.single, (productId: 'premium', basePlanId: 'monthly', accountId: 'user-1'));
      expect(api.purchaseRegistrations.single.purchaseKey, 'token-1');
      expect(store.completed, ['token-1']);
      expect(hasPremium(billing), isTrue);
      await billing.dispose();
    });

    test('cancelled in the payment sheet reaches nobody', () async {
      final billing = await started();
      store.onBuy = (p) => StorePurchase(
            productId: p.id,
            purchaseKey: '',
            status: StorePurchaseStatus.canceled,
          );

      expect((await billing.purchase(premiumProduct)).outcome, PurchaseOutcome.cancelled);
      expect(api.purchaseRegistrations, isEmpty);
      await billing.dispose();
    });

    test('a delayed payment grants access once it goes through', () async {
      final billing = await started();
      store.onBuy = (p) => StorePurchase(
            productId: p.id,
            purchaseKey: '',
            status: StorePurchaseStatus.pending,
          );

      expect((await billing.purchase(premiumProduct)).outcome, PurchaseOutcome.pending);
      expect(hasPremium(billing), isFalse);

      store.emit(paid('token-1'));
      await _settle();

      expect(hasPremium(billing), isTrue);
      expect(store.completed, ['token-1']);
      await billing.dispose();
    });

    test('stays open while the server is unreachable and is sent at the next start', () async {
      final billing = await started();
      api.billingFailure = const NetworkException('offline');
      store.onBuy = (p) {
        final purchase = paid('token-1');
        store.active.add(purchase);
        return purchase;
      };

      final result = await billing.purchase(premiumProduct);

      expect(result.outcome, PurchaseOutcome.processing);
      expect(store.completed, isEmpty);
      await billing.dispose();

      api.billingFailure = null;
      final next = await started();

      expect(store.completed, ['token-1']);
      expect(hasPremium(next), isTrue);
      await next.dispose();
    });

    test('needs a store', () async {
      store.available = false;
      final billing = await started();

      await expectLater(billing.products({'premium'}), throwsA(isA<StoreUnavailableException>()));
      await expectLater(billing.purchase(premiumProduct), throwsA(isA<StoreUnavailableException>()));
      // Entitlements come from the server anyway
      expect(api.entitlementRequests, 1);
      await billing.dispose();
    });

    test('records the funnel', () async {
      final tracker = _RecordingTracker();
      final billing = BillingManager(
        session: session,
        api: api,
        store: store,
        storage: storage,
        events: PlatformEvents(tracker),
        clock: () => now,
      );
      await billing.start();
      await _settle();
      store.onBuy = (p) => paid('token-1');

      billing.paywallShown('onboarding');
      await billing.purchase(premiumProduct, paywall: 'onboarding');

      expect(tracker.tracked.map((e) => e.name), [
        'paywall_shown',
        'purchase_started',
        'purchase_finished',
      ]);
      expect(tracker.tracked[1].properties, containsPair('paywall', 'onboarding'));
      expect(tracker.tracked.last.properties, containsPair('result', 'purchased'));
      await billing.dispose();
    });
  });

  group('restore', () {
    test('reports the server decision per purchase and completes them', () async {
      final billing = await started();
      store.active.addAll([paid('token-1'), paid('token-2')]);
      api.onRegisterPurchase = (userId, key) async => key == 'token-1'
          ? const PurchaseRegistration(
              status: RegistrationStatus.signInRequired,
              maskedEmail: 'a***@gmail.com',
              entitlements: <Entitlement>[],
            )
          : const PurchaseRegistration(
              status: RegistrationStatus.ownedByOtherAccount,
              maskedEmail: null,
              entitlements: <Entitlement>[],
            );

      final restored = await billing.restore();

      expect(restored.map((r) => r.status), [
        RestoreStatus.signInRequired,
        RestoreStatus.ownedByOtherAccount,
      ]);
      expect(restored.first.maskedEmail, 'a***@gmail.com');
      expect(store.completed, ['token-1', 'token-2']);
      expect(hasPremium(billing), isFalse);
      await billing.dispose();
    });

    test('a purchase left by an anonymous user is taken over at start', () async {
      store.active.add(paid('token-1')); // the server transfers it

      final billing = await started();

      expect(api.purchaseRegistrations.single.userId, 'user-1');
      expect(hasPremium(billing), isTrue);
      await billing.dispose();
    });
  });
}

class _RecordingTracker implements EventTracker {
  final tracked = <({String name, Map<String, Object?> properties})>[];

  @override
  void track(String name, EventCategory category, Map<String, Object?> properties) =>
      tracked.add((name: name, properties: properties));
}