import 'dart:async';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

import 'api/models.dart';
import 'api/platform_api.dart';
import 'auth/google_credentials.dart';
import 'auth/google_sign_in_flow.dart';
import 'session/session_manager.dart';
import 'storage/session_store.dart';

/// Entry point of the SDK. Call [AppPlatform.init] once at app start-up,
/// then use the returned object or [AppPlatform.instance].
class AppPlatform {
  AppPlatform._(this._session, this._api, this.clientInfo, this._googleSignIn);

  /// How long init waits for the server. A stored session is available
  /// immediately; renewal or sign-up continues in the background.
  static const _startupNetworkWait = Duration(seconds: 3);

  static Future<AppPlatform>? _initializing;
  static AppPlatform? _instance;

  final SessionManager _session;
  final PlatformApi _api;
  final GoogleSignInFlow? _googleSignIn;

  /// App and device details collected by the SDK and sent to the server.
  /// More details will be added only with analytics consent.
  final ClientInfo clientInfo;

  /// The initialized SDK. Throws if [init] has not completed.
  static AppPlatform get instance {
    final instance = _instance;
    if (instance == null) throw StateError('Call AppPlatform.init() first');
    return instance;
  }

  /// Starts the SDK. Safe to call many times; all calls share one start-up.
  /// Never fails because of the network. Fails on configuration errors
  /// (e.g. an unknown app id); a later call then tries again.
  ///
  /// [googleServerClientId] is the OAuth web client ID registered on the
  /// platform server; without it Google sign-in is disabled.
  static Future<AppPlatform> init({
    required String appId,
    required Uri baseUrl,
    String? googleServerClientId,
    http.Client? httpClient,
  }) {
    return _initializing ??= _create(appId, baseUrl, googleServerClientId, httpClient);
  }

  static Future<AppPlatform> _create(
    String appId,
    Uri baseUrl,
    String? googleServerClientId,
    http.Client? httpClient,
  ) async {
    try {
      final client = await _collectClientInfo(appId);
      final api = PlatformApi(baseUri: baseUrl, client: httpClient ?? http.Client());
      final session = SessionManager(
        api: api,
        store: SessionStore(SecureKeyValueStore()),
        client: client,
      );

      final googleSignIn = googleServerClientId == null || googleServerClientId.isEmpty
          ? null
          : GoogleSignInFlow(
              session: session,
              api: api,
              credentials: const MethodChannelGoogleCredentials(),
              serverClientId: googleServerClientId,
            );

      // Do not hold the app on a slow network; the start continues in the background
      await session.start().timeout(_startupNetworkWait, onTimeout: () {});

      return _instance = AppPlatform._(session, api, client, googleSignIn);
    } catch (_) {
      _initializing = null;
      rethrow;
    }
  }

  /// Null until the user is created on the server (e.g. first launch offline)
  String? get userId => _session.userId;

  /// Stable id of this app installation
  String? get installationId => _session.installationId;

  /// The device switched to another user after init: reload or clear
  /// everything tied to the previous user
  Stream<UserChange> get userChanges => _session.userChanges;

  /// Makes sure the device has a user and a fresh access token.
  /// Throws NetworkException / ServerException while the server is unreachable.
  Future<void> ensureSession() async {
    await _session.accessToken();
  }

  /// The current user as the server sees it
  Future<PlatformUser> me() => _session.authorized(_api.getMe);

  /// Links a Google account to the current user, or signs this device into
  /// the existing user who owns it. [resolveConflict] is called only when
  /// the account belongs to another user.
  ///
  /// Throws ApiException for refusals (already_signed_in,
  /// provider_already_linked, account_unavailable) and
  /// ProviderSignInException when the native chooser fails.
  Future<GoogleSignInResult> signInWithGoogle({
    required ResolveMergeConflict resolveConflict,
  }) {
    final flow = _googleSignIn;
    if (flow == null) {
      throw StateError('Pass googleServerClientId to AppPlatform.init to enable Google sign-in');
    }
    return flow.signIn(resolveConflict: resolveConflict);
  }

  /// Signs out on this device. The device gets a fresh anonymous user and
  /// [userChanges] reports loggedOut: clear everything of the previous user.
  /// Throws ApiException with code no_linked_account for an anonymous user,
  /// who would lose the account: offer Google sign-in instead.
  Future<void> logout() => _session.logout();

  static Future<ClientInfo> _collectClientInfo(String appId) async {
    final package = await PackageInfo.fromPlatform();
    final device = DeviceInfoPlugin();

    final DevicePlatform platform;
    final String osVersion;
    if (Platform.isAndroid) {
      platform = DevicePlatform.android;
      osVersion = (await device.androidInfo).version.release;
    } else if (Platform.isIOS) {
      platform = DevicePlatform.ios;
      osVersion = (await device.iosInfo).systemVersion;
    } else {
      throw UnsupportedError('The SDK supports Android and iOS only');
    }

    return ClientInfo(
      appId: appId,
      platform: platform,
      appVersion: package.version,
      // Empty on some build setups; the server requires a value
      appBuild: package.buildNumber.isEmpty ? '0' : package.buildNumber,
      osVersion: osVersion,
    );
  }
}