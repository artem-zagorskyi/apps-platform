/// Device platform as the server names it.
enum DevicePlatform { android, ios }

/// Provider of a linked account.
enum AuthProvider { google, apple }

/// Response of every endpoint that issues tokens.
class TokenPair {
  const TokenPair({
    required this.userId,
    required this.accessToken,
    required this.accessTokenExpiresIn,
    required this.refreshToken,
    required this.refreshTokenExpiresAt,
  });

  factory TokenPair.fromJson(Map<String, Object?> json) {
    return TokenPair(
      userId: readString(json, 'userId'),
      accessToken: readString(json, 'accessToken'),
      accessTokenExpiresIn: Duration(seconds: readInt(json, 'accessTokenExpiresIn')),
      refreshToken: readString(json, 'refreshToken'),
      refreshTokenExpiresAt: readDateTime(json, 'refreshTokenExpiresAt'),
    );
  }

  final String userId;
  final String accessToken;
  final Duration accessTokenExpiresIn;
  final String refreshToken;
  final DateTime refreshTokenExpiresAt;
}

/// A Google or Apple account linked to the user.
class LinkedAccount {
  const LinkedAccount({required this.provider, required this.email});

  factory LinkedAccount.fromJson(Map<String, Object?> json) {
    return LinkedAccount(
      provider: readEnum(AuthProvider.values, json, 'provider'),
      email: readOptionalString(json, 'email'),
    );
  }

  final AuthProvider provider;
  final String? email;
}

/// The current user as the platform server sees it (GET /v1/me).
class PlatformUser {
  const PlatformUser({
    required this.userId,
    required this.appId,
    required this.installationId,
    required this.platform,
    required this.createdAt,
    required this.linkedAccounts,
  });

  factory PlatformUser.fromJson(Map<String, Object?> json) {
    final providers = json['providers'];
    if (providers is! List<Object?>) {
      throw const FormatException('Expected list "providers"');
    }

    return PlatformUser(
      userId: readString(json, 'userId'),
      appId: readString(json, 'appId'),
      installationId: readString(json, 'installationId'),
      platform: readEnum(DevicePlatform.values, json, 'platform'),
      createdAt: readDateTime(json, 'createdAt'),
      linkedAccounts: [for (final item in providers) LinkedAccount.fromJson(readObject(item))],
    );
  }

  final String userId;
  final String appId;
  final String installationId;
  final DevicePlatform platform;
  final DateTime createdAt;
  final List<LinkedAccount> linkedAccounts;

  /// No Google or Apple account linked: progress lives only on this device
  bool get isAnonymous => linkedAccounts.isEmpty;
}

// Typed readers: a missing or mistyped field becomes a FormatException
// instead of a TypeError somewhere far from the cause.

String readString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Expected string "$key"');
}

String? readOptionalString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String) return value;
  throw FormatException('Expected string or null "$key"');
}

int readInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw FormatException('Expected integer "$key"');
}

DateTime readDateTime(Map<String, Object?> json, String key) {
  final parsed = DateTime.tryParse(readString(json, key));
  if (parsed != null) return parsed;
  throw FormatException('Expected ISO 8601 date "$key"');
}

T readEnum<T extends Enum>(List<T> values, Map<String, Object?> json, String key) {
  final name = readString(json, key);
  for (final value in values) {
    if (value.name == name) return value;
  }
  throw FormatException('Unknown value "$name" for "$key"');
}

Map<String, Object?> readObject(Object? value) {
  if (value is Map<String, Object?>) return value;
  throw const FormatException('Expected an object');
}