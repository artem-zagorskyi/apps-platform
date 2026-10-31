import 'dart:async';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

import 'api/models.dart';
import 'api/platform_api.dart';
import 'auth/google_credentials.dart';
import 'auth/google_sign_in_flow.dart';
import 'config/config_manager.dart';
import 'consent/consent_manager.dart';
import 'consent/consent_store.dart';
import 'events/app_usage.dart';
import 'events/event_manager.dart';
import 'events/event_queue.dart';
import 'events/platform_events.g.dart';
import 'session/session_manager.dart';
import 'storage/session_store.dart';

/// Entry point of the SDK. Call [AppPlatform.init] once at app start-up,
/// then use the returned object or [AppPlatform.instance].
class AppPlatform {
  AppPlatform._(
    this._session,
    this._api,
    this.clientInfo,
    this._googleSignIn,
    this.consent,
    this.events,
    this._platformEvents,
    this._usage,
    this.config,
    this._lifecycle,
  );

  /// How long init waits for the server. A stored session is available
  /// immediately; renewal or sign-up continues in the background.
  static const _startupNetworkWait = Duration(seconds: 3);

  static Future<AppPlatform>? _initializing;
  static AppPlatform? _instance;

  final SessionManager _session;
  final PlatformApi _api;
  final GoogleSignInFlow? _googleSignIn;
  final PlatformEvents _platformEvents;
  final AppUsageTracker _usage;
  // Kept so lifecycle callbacks stay registered for the app's lifetime
  // ignore: unused_field
  final AppLifecycleListener _lifecycle;

  /// App and device details collected by the SDK and sent to the server.
  /// More details will be added only with analytics consent.
  final ClientInfo clientInfo;

  /// Consent decisions: what the app may collect and personalize
  final ConsentManager consent;

  /// Event tracking. Pass it to the generated events class:
  /// `final events = AppEvents(platform.events);`
  final EventManager events;

  /// Remote config and experiments. Pass it to the generated config class:
  /// `final config = AppConfig(platform.config);`
  final ConfigManager config;

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
      // Plugins and lifecycle callbacks need the Flutter binding
      WidgetsFlutterBinding.ensureInitialized();

      final client = await _collectClientInfo(appId);
      final api = PlatformApi(baseUri: baseUrl, client: httpClient ?? http.Client());
      final storage = SecureKeyValueStore();
      final session = SessionManager(
        api: api,
        store: SessionStore(storage),
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

      // Stored decisions are available at once; the server state follows
      final consent = ConsentManager(session: session, api: api, store: ConsentStore(storage));
      await consent.load();
      unawaited(consent.trySync());

      final events = EventManager(
        session: session,
        consent: consent,
        api: api,
        queue: await SqliteEventQueue.open(),
        client: client,
      )..start();
      final platformEvents = PlatformEvents(events);

      // Install, update, app opens and sessions
      final usage = AppUsageTracker(
        store: storage,
        events: platformEvents,
        consent: consent.state,
        client: client,
        flush: events.tryFlush,
      );
      events.sessionIdProvider = () => usage.sessionId;
      await usage.start();

      // The stored config at once; on the first launch a short wait for the server
      final config = ConfigManager(
        session: session,
        api: api,
        store: storage,
        client: client,
        events: platformEvents,
        consent: consent.state,
        sessionId: () => usage.sessionId,
      );
      await config.start();

      final lifecycle = AppLifecycleListener(
        onShow: () {
          unawaited(usage.onForeground());
          config.onForeground();
        },
        onHide: () => unawaited(usage.onBackground()),
      );

      // Events queued in an earlier run are sent as soon as possible
      unawaited(events.tryFlush());

      return _instance = AppPlatform._(
        session,
        api,
        client,
        googleSignIn,
        consent,
        events,
        platformEvents,
        usage,
        config,
        lifecycle,
      );
    } catch (_) {
      _initializing = null;
      rethrow;
    }
  }

  /// Null until the user is created on the server (e.g. first launch offline)
  String? get userId => _session.userId;

  /// Stable id of this app installation
  String? get installationId => _session.installationId;

  /// Current session id, attached to every event
  String? get sessionId => _usage.sessionId;

  /// The device switched to another user after init: reload or clear
  /// everything tied to the previous user
  Stream<UserChange> get userChanges => _session.userChanges;

  /// Records that a screen was shown (screen_viewed). [screen] is a short
  /// name chosen by the app, e.g. paywall or lesson_list.
  void trackScreen(String screen) => _platformEvents.screenViewed(screen: screen);

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

  /// Deletes the account and everything the platform stores about the user.
  /// Works for every user, also anonymous ones, and cannot be undone.
  /// The device gets a fresh anonymous user and [userChanges] reports
  /// accountDeleted: clear everything of the previous user.
  /// Throws NetworkException / ServerException while the server is
  /// unreachable; nothing is deleted then.
  Future<void> deleteAccount() => _session.deleteAccount();

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