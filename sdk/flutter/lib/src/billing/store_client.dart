import 'billing_models.dart';

/// A product as the store sells it, with prices in the person's currency
class StoreProduct {
  const StoreProduct({
    required this.id,
    required this.title,
    required this.description,
    required this.offers,
    this.native,
  });

  final String id;
  final String title;
  final String description;

  /// Ways to buy it: base plans and offers of a subscription
  final List<StoreOffer> offers;

  /// The store plugin's own object; only the store client uses it
  final Object? native;
}

class StoreOffer {
  const StoreOffer({
    required this.basePlanId,
    required this.phases,
    this.offerId,
    this.native,
  });

  final String basePlanId;

  /// Null for the base plan itself
  final String? offerId;

  /// Pricing in order, e.g. a free week, then 4,99 € a month
  final List<PricingPhase> phases;

  /// The store plugin's own object; only the store client uses it
  final Object? native;

  bool get hasFreeTrial => phases.any((p) => p.priceMicros == 0);
}

class PricingPhase {
  const PricingPhase({
    required this.formattedPrice,
    required this.priceMicros,
    required this.currencyCode,
    required this.billingPeriod,
    required this.cycles,
  });

  /// Ready to show, e.g. "4,99 €"
  final String formattedPrice;
  final int priceMicros;
  final String currencyCode;

  /// ISO 8601 duration, e.g. P1M
  final String billingPeriod;

  /// How many periods this phase lasts; 0 means until cancelled
  final int cycles;
}

enum StorePurchaseStatus { pending, purchased, canceled, failed }

/// A purchase reported by the store: from a payment, a delayed payment
/// that went through, or the list of active purchases
class StorePurchase {
  const StorePurchase({
    required this.productId,
    required this.purchaseKey,
    required this.status,
    this.errorMessage,
    this.native,
  });

  final String productId;

  /// Google purchaseToken, Apple originalTransactionId; empty unless purchased
  final String purchaseKey;
  final StorePurchaseStatus status;
  final String? errorMessage;

  /// The store plugin's own object; only the store client uses it
  final Object? native;
}

/// The store behind the SDK's billing. The real one wraps in_app_purchase;
/// tests use a fake. Apps never see it.
abstract interface class StoreClient {
  BillingStore get store;

  /// False without a store app, without a store account, or on unsupported devices
  Future<bool> isAvailable();

  Future<List<StoreProduct>> products(Set<String> ids);

  /// Purchases the store reports, also outside a buy() call
  /// (a delayed payment that went through)
  Stream<StorePurchase> get purchases;

  /// Opens the payment sheet. [accountId] is recorded in the purchase
  /// (obfuscatedAccountId / appAccountToken). The outcome arrives on [purchases].
  Future<void> buy(StoreProduct product, {StoreOffer? offer, required String accountId});

  /// Active purchases of the store account on this device
  Future<List<StorePurchase>> activePurchases();

  /// Tells the store the purchase was delivered
  Future<void> complete(StorePurchase purchase);
}