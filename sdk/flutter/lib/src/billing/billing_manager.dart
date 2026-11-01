import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/platform_api.dart';
import '../errors.dart';
import '../session/session_manager.dart';
import '../storage/session_store.dart';
import 'billing_models.dart';
import 'store_client.dart';

enum PurchaseOutcome {
  /// The server confirmed it; entitlements are updated
  purchased,

  /// The person closed the payment sheet
  cancelled,

  /// Waiting for a delayed payment; entitlements update by themselves
  /// once it is paid
  pending,

  /// Paid, but the server could not be reached. Nothing is lost: the SDK
  /// sends it again at the next start-up. Show "processing".
  processing,

  /// The purchase belongs to a linked account; offer to sign in to it
  /// (see [PurchaseResult.maskedEmail])
  signInRequired,

  /// The purchase belongs to another account signed in elsewhere
  ownedByOtherAccount,

  /// The store or the server refused it
  failed,
}

class PurchaseResult {
  const PurchaseResult(this.outcome, {this.maskedEmail, this.error});

  final PurchaseOutcome outcome;

  /// For signInRequired, e.g. a***@gmail.com
  final String? maskedEmail;
  final Object? error;

  @override
  String toString() => 'PurchaseResult($outcome)';
}

enum RestoreStatus { granted, signInRequired, ownedByOtherAccount, failed }

class RestoredPurchase {
  const RestoredPurchase({required this.productId, required this.status, this.maskedEmail});

  final String productId;
  final RestoreStatus status;

  /// For signInRequired, e.g. a***@gmail.com
  final String? maskedEmail;
}

/// Subscriptions: what the user has access to, purchases and restores.
/// The server decides access; the device keeps the last answer for
/// launches without a network.
class BillingManager {
  BillingManager({
    required this._session,
    required this._api,
    required this._store,
    required KeyValueStore storage,
    DateTime Function()? clock,
  })  : _cache = _EntitlementsCache(storage),
        _clock = clock ?? DateTime.now;

  /// On return to the app, entitlements older than this are fetched again
  static const staleAfter = Duration(hours: 1);

  final SessionManager _session;
  final PlatformApi _api;
  final StoreClient _store;
  final _EntitlementsCache _cache;
  final DateTime Function() _clock;

  final _entitlements = ValueNotifier<Entitlements>(Entitlements.empty);
  final Map<String, Completer<PurchaseResult>> _waiting = {};
  StreamSubscription<StorePurchase>? _purchasesSubscription;
  StreamSubscription<UserChange>? _userSubscription;
  DateTime? _fetchedAt;
  Future<void>? _refreshing;
  bool _disposed = false;

  /// What the current user has access to: `entitlements.value.has('premium')`
  ValueListenable<Entitlements> get entitlements => _entitlements;

  /// Called by the SDK at start-up. The cached entitlements are available
  /// at once; store purchases and the server are checked in the background.
  Future<void> start() async {
    _purchasesSubscription = _store.purchases.listen((p) => unawaited(_onStorePurchase(p)));
    _userSubscription = _session.userChanges.listen(_onUserChange);
    await _loadCache();
    unawaited(_syncInBackground());
  }

  Future<void> dispose() async {
    _disposed = true;
    await _purchasesSubscription?.cancel();
    await _userSubscription?.cancel();
    for (final waiting in _waiting.values) {
      waiting.complete(const PurchaseResult(PurchaseOutcome.failed, error: 'disposed'));
    }
    _waiting.clear();
    _entitlements.dispose();
  }

  /// Asks the server what the user has access to. Throws NetworkException /
  /// ServerException while it is unreachable; the cached entitlements stay.
  Future<void> refresh() {
    final current = _refreshing;
    if (current != null) return current;

    late final Future<void> refreshing;
    refreshing = _refreshOnce().whenComplete(() {
      if (identical(_refreshing, refreshing)) _refreshing = null;
    });
    return _refreshing = refreshing;
  }

  /// Like [refresh], but failures are ignored
  Future<void> tryRefresh() async {
    try {
      await refresh();
    } on AppPlatformException {
      // Offline or the server is unavailable: the cache stays
    } catch (_) {
      // Storage failure: the in-memory state is already updated
    }
  }

  /// Called by the SDK when the app returns to the foreground
  void onForeground() {
    final fetchedAt = _fetchedAt;
    if (fetchedAt != null && _clock().difference(fetchedAt) < staleAfter) return;
    unawaited(tryRefresh());
  }

  /// Products with prices from the store. Which ids to show is the app's
  /// choice (in code or from remote config).
  /// Throws StoreUnavailableException without a usable store.
  Future<List<StoreProduct>> products(Set<String> ids) async {
    await _requireStore();
    return _store.products(ids);
  }

  /// Buys [product], with [offer] (a base plan or an offer of it) when given.
  /// Throws StoreUnavailableException without a usable store and
  /// NetworkException / ServerException when the device has no user yet and
  /// the server is unreachable; the payment sheet is not opened then.
  Future<PurchaseResult> purchase(StoreProduct product, {StoreOffer? offer}) async {
    await _requireStore();
    // The purchase records our user id: the device needs a user first
    await _session.accessToken();
    final userId = _session.userId;
    if (userId == null) throw StateError('No user after renewal');

    if (_waiting.containsKey(product.id)) {
      throw StateError('A purchase of ${product.id} is already in progress');
    }
    final completer = Completer<PurchaseResult>();
    _waiting[product.id] = completer;

    try {
      await _store.buy(product, offer: offer, accountId: userId);
    } catch (e) {
      _waiting.remove(product.id);
      return PurchaseResult(PurchaseOutcome.failed, error: e);
    }
    return completer.future;
  }

  /// Sends the active purchases of the store account to the server and
  /// tells, per purchase, whether this user got it.
  /// Throws StoreUnavailableException without a usable store and
  /// NetworkException / ServerException while the server is unreachable.
  Future<List<RestoredPurchase>> restore() async {
    await _requireStore();
    final found = [
      for (final p in await _store.activePurchases())
        if (p.status == StorePurchaseStatus.purchased) p,
    ];

    final results = <RestoredPurchase>[];
    for (final purchase in found) {
      try {
        final registration = await _register(purchase);
        results.add(RestoredPurchase(
          productId: purchase.productId,
          status: _restoreStatus(registration.status),
          maskedEmail: registration.maskedEmail,
        ));
      } on ApiException {
        results.add(RestoredPurchase(productId: purchase.productId, status: RestoreStatus.failed));
      }
    }

    // Nothing in the store: the server may still know purchases of this account
    if (found.isEmpty) await refresh();
    return results;
  }

  Future<void> _requireStore() async {
    if (!await _store.isAvailable()) {
      throw const StoreUnavailableException('The store is not available on this device');
    }
  }

  Future<void> _refreshOnce() async {
    String? userId;
    final list = await _session.authorized((token) {
      // The user this answer belongs to
      userId = _session.userId;
      return _api.getEntitlements(token);
    });
    await _apply(userId, list);
  }

  // Registers a paid purchase and completes it in the store once the server
  // has answered. Throws NetworkException / ServerException while the server
  // is unreachable: the purchase stays open in the store.
  Future<PurchaseRegistration> _register(StorePurchase purchase) async {
    String? userId;
    final registration = await _session.authorized((token) {
      userId = _session.userId;
      return _api.registerPurchase(
        token,
        store: _store.store,
        productId: purchase.productId,
        purchaseKey: purchase.purchaseKey,
      );
    });
    await _apply(userId, registration.entitlements);

    // The server has it and confirmed it to the store: the store may close it
    try {
      await _store.complete(purchase);
    } catch (_) {
      // Completed again at the next start-up
    }
    return registration;
  }

  Future<void> _onStorePurchase(StorePurchase purchase) async {
    switch (purchase.status) {
      case StorePurchaseStatus.pending:
        _finish(purchase.productId, const PurchaseResult(PurchaseOutcome.pending));
      case StorePurchaseStatus.canceled:
        _finish(purchase.productId, const PurchaseResult(PurchaseOutcome.cancelled));
      case StorePurchaseStatus.failed:
        _finish(
          purchase.productId,
          PurchaseResult(PurchaseOutcome.failed, error: purchase.errorMessage),
        );
      case StorePurchaseStatus.purchased:
        _finish(purchase.productId, await _deliver(purchase));
    }
  }

  // Also for purchases nobody waits for: a delayed payment that went through
  Future<PurchaseResult> _deliver(StorePurchase purchase) async {
    try {
      final registration = await _register(purchase);
      return switch (registration.status) {
        RegistrationStatus.owned ||
        RegistrationStatus.transferred =>
          const PurchaseResult(PurchaseOutcome.purchased),
        RegistrationStatus.signInRequired =>
          PurchaseResult(PurchaseOutcome.signInRequired, maskedEmail: registration.maskedEmail),
        RegistrationStatus.ownedByOtherAccount =>
          const PurchaseResult(PurchaseOutcome.ownedByOtherAccount),
      };
    } on NetworkException catch (e) {
      return PurchaseResult(PurchaseOutcome.processing, error: e);
    } on ServerException catch (e) {
      return PurchaseResult(PurchaseOutcome.processing, error: e);
    } catch (e) {
      return PurchaseResult(PurchaseOutcome.failed, error: e);
    }
  }

  void _finish(String productId, PurchaseResult result) {
    _waiting.remove(productId)?.complete(result);
  }

  // Open purchases of earlier runs (server unreachable then, or bought
  // before a reinstall) go to the server; then the entitlements are fetched
  Future<void> _syncInBackground() async {
    try {
      if (await _store.isAvailable()) {
        for (final purchase in await _store.activePurchases()) {
          if (purchase.status == StorePurchaseStatus.purchased) await _register(purchase);
        }
      }
    } catch (_) {
      // Offline, store trouble or a refused purchase: tried again next start
    }
    await tryRefresh();
  }

  Future<void> _loadCache() async {
    final userId = _session.userId;
    if (userId == null) return;
    try {
      final cached = await _cache.read(userId);
      if (cached == null || _disposed || _session.userId != userId) return;
      _entitlements.value = cached.entitlements;
      _fetchedAt = cached.fetchedAt;
    } catch (_) {
      // Unreadable storage: the server answer follows
    }
  }

  Future<void> _apply(String? userId, List<Entitlement> list) async {
    // An answer for a previous user is discarded
    if (_disposed || userId == null || _session.userId != userId) return;

    final now = _clock();
    _entitlements.value = Entitlements(List.unmodifiable(list));
    _fetchedAt = now;
    try {
      await _cache.write(userId, list, now);
    } catch (_) {
      // Kept in memory; written again with the next answer
    }
  }

  void _onUserChange(UserChange change) {
    if (_disposed) return;
    // A refresh still in flight belongs to the previous user
    _refreshing = null;
    _entitlements.value = Entitlements.empty;
    _fetchedAt = null;
    unawaited(_resetForNewUser());
  }

  Future<void> _resetForNewUser() async {
    try {
      await _cache.clear();
    } catch (_) {
      // The cache is tied to its user and ignored for anyone else
    }
    await tryRefresh();
  }

  static RestoreStatus _restoreStatus(RegistrationStatus status) => switch (status) {
        RegistrationStatus.owned || RegistrationStatus.transferred => RestoreStatus.granted,
        RegistrationStatus.signInRequired => RestoreStatus.signInRequired,
        RegistrationStatus.ownedByOtherAccount => RestoreStatus.ownedByOtherAccount,
      };
}

// The last entitlements from the server, for launches without a network
class _EntitlementsCache {
  _EntitlementsCache(this._store, {String keyPrefix = 'app_platform'})
      : _key = '$keyPrefix.entitlements';

  final KeyValueStore _store;
  final String _key;

  /// Null if nothing is stored, it belongs to another user or is unreadable
  Future<({Entitlements entitlements, DateTime fetchedAt})?> read(String userId) async {
    final raw = await _store.read(_key);
    if (raw == null) return null;

    try {
      final json = jsonDecode(raw);
      if (json is! Map<String, Object?> || json['userId'] != userId) return null;
      final fetchedAt = json['fetchedAt'];
      if (fetchedAt is! String) return null;
      return (
        entitlements: Entitlements(Entitlement.listFromJson(json['entitlements'])),
        fetchedAt: DateTime.parse(fetchedAt),
      );
    } on FormatException {
      return null;
    }
  }

  Future<void> write(String userId, List<Entitlement> entitlements, DateTime fetchedAt) =>
      _store.write(
        _key,
        jsonEncode({
          'userId': userId,
          'fetchedAt': fetchedAt.toUtc().toIso8601String(),
          'entitlements': [for (final e in entitlements) e.toJson()],
        }),
      );

  Future<void> clear() => _store.delete(_key);
}