import 'dart:async';

import 'package:renvix_sdk/src/billing/billing_models.dart';
import 'package:renvix_sdk/src/billing/store_client.dart';

const premiumProduct = StoreProduct(
  id: 'premium',
  title: 'Premium',
  description: 'Everything unlocked',
  offers: [
    StoreOffer(
      basePlanId: 'monthly',
      phases: [
        PricingPhase(
          formattedPrice: '4,99 €',
          priceMicros: 4990000,
          currencyCode: 'EUR',
          billingPeriod: 'P1M',
          cycles: 0,
        ),
      ],
    ),
  ],
);

StorePurchase paid(String purchaseKey) => StorePurchase(
      productId: 'premium',
      purchaseKey: purchaseKey,
      status: StorePurchaseStatus.purchased,
    );

/// A Google Play stand-in: tests decide what the payment sheet does
class FakeStoreClient implements StoreClient {
  bool available = true;
  final catalog = <StoreProduct>[premiumProduct];
  final active = <StorePurchase>[];
  final bought = <({String productId, String? basePlanId, String accountId})>[];
  final completed = <String>[];
  final _purchases = StreamController<StorePurchase>.broadcast();

  /// What the payment sheet reports after buy(); null leaves it open
  StorePurchase? Function(StoreProduct product)? onBuy;

  void emit(StorePurchase purchase) => _purchases.add(purchase);

  @override
  BillingStore get store => BillingStore.googlePlay;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<List<StoreProduct>> products(Set<String> ids) async => [
        for (final p in catalog)
          if (ids.contains(p.id)) p,
      ];

  @override
  Stream<StorePurchase> get purchases => _purchases.stream;

  @override
  Future<void> buy(StoreProduct product, {StoreOffer? offer, required String accountId}) async {
    bought.add((productId: product.id, basePlanId: offer?.basePlanId, accountId: accountId));
    final outcome = onBuy?.call(product);
    if (outcome != null) emit(outcome);
  }

  @override
  Future<List<StorePurchase>> activePurchases() async => List.of(active);

  @override
  Future<void> complete(StorePurchase purchase) async => completed.add(purchase.purchaseKey);
}