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

/// What happens to this device's progress when it signs into an
/// existing account. The app backend receives it with the merge.
enum MergeStrategy {
  /// Keep the existing account's progress; this device's progress is discarded
  keepTarget('keep_target'),

  /// Copy this device's progress into the existing account
  keepSource('keep_source'),

  /// Let the app backend combine both
  merge('merge');

  const MergeStrategy(this.wireName);

  /// Value sent to the server
  final String wireName;
}

/// One-time value the provider embeds into its ID token.
class SignInNonce {
  const SignInNonce({required this.nonce, required this.expiresAt});

  factory SignInNonce.fromJson(Map<String, Object?> json) {
    return SignInNonce(
      nonce: readString(json, 'nonce'),
      expiresAt: readDateTime(json, 'expiresAt'),
    );
  }

  final String nonce;
  final DateTime expiresAt;
}

enum ProviderSignInOutcome { linked, alreadyLinked, signedIn }

/// Response of POST /v1/auth/google (and later /v1/auth/apple).
class ProviderSignInResponse {
  const ProviderSignInResponse({
    required this.outcome,
    required this.userId,
    required this.tokens,
  });

  factory ProviderSignInResponse.fromJson(Map<String, Object?> json) {
    final outcome = switch (readString(json, 'result')) {
      'linked' => ProviderSignInOutcome.linked,
      'already_linked' => ProviderSignInOutcome.alreadyLinked,
      'signed_in' => ProviderSignInOutcome.signedIn,
      final other => throw FormatException('Unknown sign-in result "$other"'),
    };
    final tokens = json['tokens'];

    return ProviderSignInResponse(
      outcome: outcome,
      userId: readString(json, 'userId'),
      tokens: tokens == null ? null : TokenPair.fromJson(readObject(tokens)),
    );
  }

  final ProviderSignInOutcome outcome;
  final String userId;

  /// Set only for signedIn: the device switched to another user
  final TokenPair? tokens;
}