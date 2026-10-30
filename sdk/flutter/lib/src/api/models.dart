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

/// Purposes on the platform's consent screen. Ads consent comes later.
enum ConsentPurpose { analytics, personalization }

enum ConsentMode {
  /// No consent screen; analytics is on unless switched off in settings
  none('none'),

  /// Consent screen; the app works after a refusal
  optional('optional'),

  /// Consent or an ad-free subscription (with the ads system)
  consentOrPay('consent_or_pay');

  const ConsentMode(this.wireName);
  final String wireName;
}

/// Where the person made the choice.
enum ConsentSource {
  firstLaunch('first_launch'),
  reprompt('reprompt'),
  settings('settings');

  const ConsentSource(this.wireName);
  final String wireName;
}

class ConsentDecision {
  const ConsentDecision({
    required this.granted,
    required this.policyVersion,
    required this.decidedAt,
  });

  final bool granted;

  /// Empty when decided on the device before the policy was known
  final String policyVersion;
  final DateTime decidedAt;
}

/// Response of GET and POST /v1/consent.
class ServerConsentState {
  const ServerConsentState({
    required this.mode,
    required this.policyVersion,
    required this.decisions,
    required this.canAskAgainAt,
  });

  factory ServerConsentState.fromJson(Map<String, Object?> json) {
    final policy = readObject(json['policy']);
    final rawDecisions = json['decisions'];
    if (rawDecisions is! List<Object?>) {
      throw const FormatException('Expected list "decisions"');
    }

    final decisions = <ConsentPurpose, ConsentDecision>{};
    for (final item in rawDecisions) {
      final decision = readObject(item);
      final name = readString(decision, 'purpose');
      final purpose = ConsentPurpose.values.where((p) => p.name == name).firstOrNull;
      // Other purposes (ads) are not handled by this part of the SDK
      if (purpose == null) continue;
      decisions[purpose] = ConsentDecision(
        granted: readBool(decision, 'granted'),
        policyVersion: readString(decision, 'policyVersion'),
        decidedAt: readDateTime(decision, 'decidedAt'),
      );
    }

    return ServerConsentState(
      mode: readWireEnum(ConsentMode.values, (m) => m.wireName, policy, 'mode'),
      policyVersion: readString(policy, 'version'),
      decisions: decisions,
      canAskAgainAt: json['canAskAgainAt'] == null ? null : readDateTime(json, 'canAskAgainAt'),
    );
  }

  final ConsentMode mode;
  final String policyVersion;
  final Map<ConsentPurpose, ConsentDecision> decisions;
  final DateTime? canAskAgainAt;
}

bool readBool(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw FormatException('Expected boolean "$key"');
}

/// Reads an enum stored under a different name on the wire (e.g. snake_case)
T readWireEnum<T extends Enum>(
  List<T> values,
  String Function(T) wireName,
  Map<String, Object?> json,
  String key,
) {
  final name = readString(json, key);
  for (final value in values) {
    if (wireName(value) == name) return value;
  }
  throw FormatException('Unknown value "$name" for "$key"');
}

/// Response of POST /v1/events.
class EventBatchResult {
  const EventBatchResult({required this.accepted, required this.rejected});

  factory EventBatchResult.fromJson(Map<String, Object?> json) {
    final accepted = json['accepted'];
    final rejected = json['rejected'];
    if (accepted is! List<Object?> || rejected is! List<Object?>) {
      throw const FormatException('Expected lists "accepted" and "rejected"');
    }

    return EventBatchResult(
      accepted: [
        for (final id in accepted)
          if (id is String) id else throw const FormatException('Expected event ids'),
      ],
      rejected: [
        for (final item in rejected)
          (
            eventId: readString(readObject(item), 'eventId'),
            reason: readString(readObject(item), 'reason'),
          ),
      ],
    );
  }

  /// Stored now or before: drop from the queue
  final List<String> accepted;

  /// Never stored (e.g. no consent): drop from the queue too
  final List<({String eventId, String reason})> rejected;
}

/// One experiment the user is in, as reported by the server
class ConfigExperiment {
  const ConfigExperiment({
    required this.key,
    required this.variant,
    required this.parameters,
    this.forced = false,
  });

  factory ConfigExperiment.fromJson(Map<String, Object?> json) => ConfigExperiment(
        key: readString(json, 'key'),
        variant: readString(json, 'variant'),
        parameters: readStringList(json, 'parameters'),
        forced: json['forced'] == true,
      );

  final String key;
  final String variant;

  /// Parameters whose value comes from this experiment
  final List<String> parameters;

  /// A tester's forced variant: no exposures are recorded
  final bool forced;

  Map<String, Object?> toJson() => {
        'key': key,
        'variant': variant,
        'parameters': parameters,
        if (forced) 'forced': true,
      };
}

/// Config of the user as computed by the server
class ServerConfig {
  const ServerConfig({required this.version, required this.values, required this.experiments});

  factory ServerConfig.fromJson(Map<String, Object?> json) {
    final rawExperiments = json['experiments'];
    if (rawExperiments is! List<Object?>) {
      throw const FormatException('Expected a list "experiments"');
    }
    return ServerConfig(
      version: readInt(json, 'version'),
      values: readObject(json['values']),
      experiments: [for (final e in rawExperiments) ConfigExperiment.fromJson(readObject(e))],
    );
  }

  /// 0 when nothing is published yet
  final int version;
  final Map<String, Object?> values;
  final List<ConfigExperiment> experiments;

  Map<String, Object?> toJson() => {
        'version': version,
        'values': values,
        'experiments': [for (final e in experiments) e.toJson()],
      };
}

class ConfigResponse {
  const ConfigResponse({required this.config, required this.etag});

  final ServerConfig config;
  final String? etag;
}

List<String> readStringList(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! List<Object?> || value.any((e) => e is! String)) {
    throw FormatException('Expected a list of strings "$key"');
  }
  return value.cast<String>();
}