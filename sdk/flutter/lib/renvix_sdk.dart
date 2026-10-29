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
        PlatformUser;
export 'src/app_platform.dart';
export 'src/auth/google_sign_in_flow.dart' show GoogleSignInResult, ResolveMergeConflict;
export 'src/consent/consent_manager.dart' show ConsentManager, ConsentState, ConsentStatus;
export 'src/errors.dart';
export 'src/session/session_manager.dart' show ClientInfo, UserChange, UserChangeReason;
export 'src/version.dart';