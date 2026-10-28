/// Device platform as the server names it.
enum DevicePlatform { android, ios }

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

// Typed readers: a missing or mistyped field becomes a FormatException
// instead of a TypeError somewhere far from the cause.

String readString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Expected string "$key"');
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