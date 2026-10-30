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
export 'src/auth/google_sign_in_flow.dart' show GoogleSignInResult, ResolveMergeConflict;
export 'src/config/config_manager.dart' show ConfigManager;
export 'src/config/config_source.dart';
export 'src/consent/consent_manager.dart' show ConsentManager, ConsentState, ConsentStatus;
export 'src/errors.dart';
export 'src/events/event_manager.dart' show EventManager;
export 'src/events/event_tracker.dart';
export 'src/session/session_manager.dart' show ClientInfo, UserChange, UserChangeReason;
export 'src/version.dart';