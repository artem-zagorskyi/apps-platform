/// Client SDK for the Renvix apps platform.
library;

export 'src/api/models.dart'
    show
        AuthProvider,
        ConsentPurpose,
        ConsentSource,
        DevicePlatform,
        LinkedAccount,
        MergeStrategy,
        ConfigExperiment,
        PlatformUser;
export 'src/app_platform.dart';
export 'src/auth/provider_sign_in.dart' show ResolveMergeConflict, SignInResult;
export 'src/billing/billing_manager.dart'
    show BillingManager, PurchaseOutcome, PurchaseResult, RestoreStatus, RestoredPurchase;
export 'src/billing/billing_models.dart';
export 'src/billing/store_client.dart' show PricingPhase, StoreOffer, StoreProduct;
export 'src/config/config_manager.dart' show ConfigManager;
export 'src/config/config_source.dart';
export 'src/consent/consent_manager.dart' show ConsentManager, ConsentState, ConsentStatus;
export 'src/errors.dart';
export 'src/events/event_manager.dart' show EventManager;
export 'src/events/event_tracker.dart';
export 'src/session/session_manager.dart' show ClientInfo, UserChange, UserChangeReason;
export 'src/version.dart';