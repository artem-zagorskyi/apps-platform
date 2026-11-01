import 'dart:async';
import 'dart:io';

import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_android/in_app_purchase_android.dart';

import '../errors.dart';
import 'billing_models.dart';
import 'store_client.dart';

/// Google Play through the official in_app_purchase plugin.
/// iOS reports the store as unavailable until the App Store part is built.
class InAppPurchaseStoreClient implements StoreClient {
  InAppPurchaseStoreClient([InAppPurchase? plugin]) : _plugin = plugin ?? InAppPurchase.instance;

  final InAppPurchase _plugin;

  @override
  BillingStore get store => Platform.isIOS ? BillingStore.appStore : BillingStore.googlePlay;

  @override
  Future<bool> isAvailable() async {
    // StoreKit support comes with the App Store provider
    if (!Platform.isAndroid) return false;
    try {
      return await _plugin.isAvailable();
    } catch (_) {
      return false;
    }
  }

  @override
  Future<List<StoreProduct>> products(Set<String> ids) async {
    final response = await _plugin.queryProductDetails(ids);
    final error = response.error;
    if (error != null) throw StoreUnavailableException(error.message);

    // Google returns one entry per base plan and offer: group them by product
    final byId = <String, List<GooglePlayProductDetails>>{};
    for (final details in response.productDetails) {
      if (details is GooglePlayProductDetails) {
        byId.putIfAbsent(details.id, () => []).add(details);
      }
    }
    return [for (final variants in byId.values) _product(variants)];
  }

  @override
  Stream<StorePurchase> get purchases =>
      _plugin.purchaseStream.expand((list) => list.map(_purchase));

  @override
  Future<void> buy(StoreProduct product, {StoreOffer? offer, required String accountId}) async {
    final chosen = offer ?? _basePlan(product);
    final details = chosen?.native ?? product.native;
    if (details is! ProductDetails) throw StateError('Product ${product.id} has no store details');

    final opened = await _plugin.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: details, applicationUserName: accountId),
    );
    if (!opened) throw const StoreUnavailableException('The payment sheet could not be opened');
  }

  @override
  Future<List<StorePurchase>> activePurchases() async {
    final android = _plugin.getPlatformAddition<InAppPurchaseAndroidPlatformAddition>();
    final response = await android.queryPastPurchases();
    final error = response.error;
    if (error != null) throw StoreUnavailableException(error.message);
    return [for (final p in response.pastPurchases) _purchase(p)];
  }

  @override
  Future<void> complete(StorePurchase purchase) async {
    final details = purchase.native;
    if (details is PurchaseDetails && details.pendingCompletePurchase) {
      await _plugin.completePurchase(details);
    }
  }

  // Without a chosen offer: the plain base plan, else the first offer
  static StoreOffer? _basePlan(StoreProduct product) {
    for (final offer in product.offers) {
      if (offer.offerId == null) return offer;
    }
    return product.offers.isEmpty ? null : product.offers.first;
  }

  static StoreProduct _product(List<GooglePlayProductDetails> variants) {
    final first = variants.first;
    return StoreProduct(
      id: first.id,
      title: first.title,
      description: first.description,
      offers: [
        for (final variant in variants)
          if (variant.subscriptionIndex != null) _offer(variant),
      ],
      native: first,
    );
  }

  static StoreOffer _offer(GooglePlayProductDetails variant) {
    final details = variant.productDetails.subscriptionOfferDetails![variant.subscriptionIndex!];
    return StoreOffer(
      basePlanId: details.basePlanId,
      offerId: details.offerId,
      phases: [
        for (final phase in details.pricingPhases)
          PricingPhase(
            formattedPrice: phase.formattedPrice,
            priceMicros: phase.priceAmountMicros,
            currencyCode: phase.priceCurrencyCode,
            billingPeriod: phase.billingPeriod,
            cycles: phase.billingCycleCount,
          ),
      ],
      native: variant,
    );
  }

  static StorePurchase _purchase(PurchaseDetails details) => StorePurchase(
        productId: details.productID,
        // Google: the purchase token
        purchaseKey: details.verificationData.serverVerificationData,
        status: switch (details.status) {
          PurchaseStatus.pending => StorePurchaseStatus.pending,
          PurchaseStatus.purchased || PurchaseStatus.restored => StorePurchaseStatus.purchased,
          PurchaseStatus.canceled => StorePurchaseStatus.canceled,
          PurchaseStatus.error => StorePurchaseStatus.failed,
        },
        errorMessage: details.error?.message,
        native: details,
      );
}