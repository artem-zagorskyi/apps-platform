import 'package:flutter/services.dart';

import '../errors.dart';

/// Native Google account chooser. Kept behind an interface so the
/// sign-in flow can be tested without a device.
abstract interface class GoogleCredentialProvider {
  /// Shows the Google account chooser and returns an ID token that
  /// contains [nonce], or null if the person closed the chooser.
  Future<String?> requestIdToken({
    required String serverClientId,
    required String nonce,
  });
}

/// Calls the SDK's native code (Android Credential Manager).
class MethodChannelGoogleCredentials implements GoogleCredentialProvider {
  const MethodChannelGoogleCredentials();

  static const _channel = MethodChannel('app_platform/google_sign_in');

  @override
  Future<String?> requestIdToken({
    required String serverClientId,
    required String nonce,
  }) async {
    try {
      return await _channel.invokeMethod<String>('requestGoogleIdToken', {
        'serverClientId': serverClientId,
        'nonce': nonce,
      });
    } on PlatformException catch (e) {
      throw ProviderSignInException(code: e.code, message: e.message ?? e.code);
    } on MissingPluginException {
      throw const ProviderSignInException(
        code: 'unsupported_platform',
        message: 'Google sign-in is not available on this platform yet',
      );
    }
  }
}