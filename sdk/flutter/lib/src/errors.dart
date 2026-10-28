/// Base class of every error thrown by the SDK.
/// Sealed: a `switch` over it must handle every subtype.
sealed class AppPlatformException implements Exception {
  const AppPlatformException(this.message);

  final String message;

  @override
  String toString() => '$runtimeType: $message';
}

/// The server rejected the request with a known error code.
/// Branch on [code]; see [ApiErrorCode].
final class ApiException extends AppPlatformException {
  const ApiException({
    required this.statusCode,
    required this.code,
    required String message,
  }) : super(message);

  final int statusCode;
  final String code;

  @override
  String toString() => 'ApiException($statusCode $code): $message';
}

/// The server failed, is overloaded or rate limited the client.
/// The request may succeed later.
final class ServerException extends AppPlatformException {
  const ServerException({required this.statusCode, required String message})
      : super(message);

  final int statusCode;

  @override
  String toString() => 'ServerException($statusCode): $message';
}

/// No response at all: offline, DNS failure, timeout.
/// The request may succeed later.
final class NetworkException extends AppPlatformException {
  const NetworkException(super.message, {this.cause});

  final Object? cause;
}

/// Error codes returned by the platform server.
abstract final class ApiErrorCode {
  static const validationFailed = 'validation_failed';
  static const unknownApp = 'unknown_app';
  static const unauthorized = 'unauthorized';
  static const invalidRefreshToken = 'invalid_refresh_token';
  static const invalidProviderToken = 'invalid_provider_token';
  static const installationExists = 'installation_exists';
  static const accountExists = 'account_exists';
  static const alreadySignedIn = 'already_signed_in';
  static const providerAlreadyLinked = 'provider_already_linked';
  static const accountUnavailable = 'account_unavailable';
  static const noLinkedAccount = 'no_linked_account';

  /// Used when an error response had no readable code
  static const unknown = 'unknown';
}