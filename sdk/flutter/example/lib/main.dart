import 'dart:async';

import 'package:flutter/material.dart';
import 'package:renvix_sdk/renvix_sdk.dart';

import 'consent_screen.dart';

// Set with --dart-define-from-file=dev.json (see dev.example.json)
const _appId = String.fromEnvironment('PLATFORM_APP_ID');
const _apiUrl = String.fromEnvironment(
  'PLATFORM_API_URL',
  defaultValue: 'http://10.0.2.2:3000',
);
const _googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');

void main() {
  runApp(const DemoApp());
}

/// Test bench for the SDK: shows its state and triggers every flow.
class DemoApp extends StatelessWidget {
  const DemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Platform SDK demo',
      theme: ThemeData(colorSchemeSeed: Colors.indigo),
      home: const DemoHomePage(),
    );
  }
}

class DemoHomePage extends StatefulWidget {
  const DemoHomePage({super.key});

  @override
  State<DemoHomePage> createState() => _DemoHomePageState();
}

class _DemoHomePageState extends State<DemoHomePage> {
  final List<String> _log = [];
  AppPlatform? _platform;
  PlatformUser? _profile;
  StreamSubscription<UserChange>? _changes;
  bool _busy = false;
  bool _consentScreenOpen = false;

  @override
  void initState() {
    super.initState();
    if (_appId.isEmpty) {
      _log.add('PLATFORM_APP_ID is not set: run with --dart-define-from-file=dev.json');
    } else {
      // After the first frame, so the screen shows while the SDK starts
      WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_init()));
    }
  }

  @override
  void dispose() {
    _platform?.consent.state.removeListener(_onConsentChanged);
    unawaited(_changes?.cancel());
    super.dispose();
  }

  Future<void> _init() => _run('init', () async {
        final platform = await AppPlatform.init(
          appId: _appId,
          baseUrl: Uri.parse(_apiUrl),
          googleServerClientId: _googleServerClientId,
        );
        _changes = platform.userChanges.listen(_onUserChange);
        setState(() => _platform = platform);

        platform.consent.state.addListener(_onConsentChanged);
        _onConsentChanged();
      });

  // Another user now owns the device: drop everything of the previous one.
  // A real app clears its local data and caches here.
  void _onUserChange(UserChange change) {
    _addLog('$change');
    setState(() => _profile = null);
  }

  // Shows the consent screen whenever a decision is needed:
  // first launch, after logout, after a new policy version
  void _onConsentChanged() {
    final platform = _platform;
    if (!mounted || platform == null || _consentScreenOpen) return;
    if (platform.consent.state.value.status == ConsentStatus.needsDecision) {
      unawaited(_askForConsent(ConsentSource.firstLaunch));
    }
  }

  Future<void> _askForConsent(ConsentSource source) async {
    final platform = _platform;
    if (platform == null || _consentScreenOpen) return;

    _consentScreenOpen = true;
    try {
      final choice = await showDialog<ConsentChoice>(
        context: context,
        barrierDismissible: false,
        builder: (_) => const ConsentScreen(),
      );
      if (choice == null) return;

      await platform.consent.record(
        analytics: choice.analytics,
        personalization: choice.personalization,
        source: source,
      );
      _addLog(
        'consent (${source.name}): analytics ${choice.analytics}, '
        'personalization ${choice.personalization}',
      );
    } finally {
      _consentScreenOpen = false;
    }
  }

  // The settings toggles: change one decision at a time
  Future<void> _changeConsent({bool? analytics, bool? personalization}) =>
      _run('consent', () async {
        await _platform?.consent.record(
          analytics: analytics,
          personalization: personalization,
          source: ConsentSource.settings,
        );
      });

  Future<void> _ensureSession() => _run('session', () async {
        await _platform?.ensureSession();
        setState(() {});
      });

  Future<void> _loadProfile() => _run('profile', () async {
        final platform = _platform;
        if (platform == null) return;
        final profile = await platform.me();
        setState(() => _profile = profile);
      });

  Future<void> _signInWithGoogle() => _run('google', () async {
        final platform = _platform;
        if (platform == null) return;

        final result = await platform.signInWithGoogle(resolveConflict: _chooseMergeStrategy);
        _addLog('google result: ${result.name}');

        if (result != GoogleSignInResult.cancelled) {
          final profile = await platform.me();
          setState(() => _profile = profile);
        }
      });

  Future<void> _logout() => _run('logout', () async {
        final platform = _platform;
        if (platform == null) return;

        await platform.logout();
        final profile = await platform.me();
        setState(() => _profile = profile);
      });

  // The demo always asks. A real app returns keepTarget without asking
  // when this device has no progress worth keeping.
  Future<MergeStrategy?> _chooseMergeStrategy() {
    if (!mounted) return Future.value();
    return showDialog<MergeStrategy>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('This Google account already has progress'),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, MergeStrategy.keepTarget),
            child: const Text('Keep the account progress'),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, MergeStrategy.keepSource),
            child: const Text('Keep progress from this device'),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, MergeStrategy.merge),
            child: const Text('Combine both'),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }

  // Runs an SDK call and writes the outcome to the on-screen log
  Future<void> _run(String label, Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      _addLog('$label: ok');
    } on AppPlatformException catch (e) {
      _addLog('$label failed: $e');
    } catch (e) {
      _addLog('$label failed unexpectedly: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _addLog(String line) {
    if (!mounted) return;
    final time = DateTime.now().toIso8601String().substring(11, 19);
    setState(() => _log.insert(0, '$time  $line'));
  }

  @override
  Widget build(BuildContext context) {
    final platform = _platform;
    final profile = _profile;
    final canAct = platform != null && !_busy;
    final googleConfigured = _googleServerClientId.isNotEmpty;
    final titleStyle = Theme.of(context).textTheme.titleMedium;

    return Scaffold(
      appBar: AppBar(title: const Text('Platform SDK demo')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('SDK version $sdkVersion'),
          Text('Server: $_apiUrl'),
          const Divider(height: 32),
          _Field('Installation', platform?.installationId),
          _Field(
            'User',
            platform == null ? null : (platform.userId ?? 'not created yet (offline?)'),
          ),
          if (profile != null) ...[
            _Field(
              'Account',
              profile.isAnonymous
                  ? 'anonymous'
                  : profile.linkedAccounts
                      .map((a) => '${a.provider.name}: ${a.email ?? '-'}')
                      .join(', '),
            ),
            _Field('Created', profile.createdAt.toLocal().toString()),
          ],
          if (platform != null) ...[
            const Divider(height: 32),
            Text('Consent', style: titleStyle),
            const SizedBox(height: 8),
            ValueListenableBuilder<ConsentState>(
              valueListenable: platform.consent.state,
              builder: (context, consent, _) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Field('Status', consent.status.name),
                  _Field('Policy', consent.policyVersion ?? 'unknown (offline)'),
                  if (consent.canAskAgainAt case final askAgain?)
                    _Field('Ask again', askAgain.toLocal().toString()),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Analytics'),
                    value: consent.analytics,
                    onChanged: canAct ? (value) => unawaited(_changeConsent(analytics: value)) : null,
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Personalization'),
                    value: consent.personalization,
                    onChanged:
                        canAct ? (value) => unawaited(_changeConsent(personalization: value)) : null,
                  ),
                  TextButton(
                    onPressed: canAct ? () => unawaited(_askForConsent(ConsentSource.reprompt)) : null,
                    child: const Text('Show consent screen'),
                  ),
                ],
              ),
            ),
            const Divider(height: 32),
            Text('Collected on this device', style: titleStyle),
            const SizedBox(height: 8),
            _Field('Platform', platform.clientInfo.platform.name),
            _Field(
              'App',
              '${platform.clientInfo.appVersion} (build ${platform.clientInfo.appBuild})',
            ),
            _Field('OS', platform.clientInfo.osVersion),
            const Text(
              'More device details will be collected only with analytics consent.',
              style: TextStyle(fontSize: 12),
            ),
          ],
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                onPressed: canAct ? _ensureSession : null,
                child: const Text('Ensure session'),
              ),
              OutlinedButton(
                onPressed: canAct ? _loadProfile : null,
                child: const Text('Load profile'),
              ),
              FilledButton.tonal(
                onPressed: canAct && googleConfigured ? _signInWithGoogle : null,
                child: const Text('Sign in with Google'),
              ),
              OutlinedButton(
                onPressed: canAct ? _logout : null,
                child: const Text('Sign out'),
              ),
            ],
          ),
          if (!googleConfigured)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'Google sign-in is off: set GOOGLE_SERVER_CLIENT_ID in dev.json',
                style: TextStyle(fontSize: 12),
              ),
            ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.only(top: 16),
              child: LinearProgressIndicator(),
            ),
          const Divider(height: 32),
          Text('Log', style: titleStyle),
          for (final line in _log)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Text(
                line,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field(this.label, this.value);

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
          Expanded(child: SelectableText(value ?? '-')),
        ],
      ),
    );
  }
}