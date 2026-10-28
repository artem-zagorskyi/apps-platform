import 'dart:async';

import 'package:flutter/material.dart';
import 'package:renvix_sdk/renvix_sdk.dart';

// Set with --dart-define-from-file=dev.json (see dev.example.json)
const _appId = String.fromEnvironment('PLATFORM_APP_ID');
const _apiUrl = String.fromEnvironment(
  'PLATFORM_API_URL',
  defaultValue: 'http://10.0.2.2:3000',
);

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
    unawaited(_changes?.cancel());
    super.dispose();
  }

  Future<void> _init() => _run('init', () async {
        final platform = await AppPlatform.init(appId: _appId, baseUrl: Uri.parse(_apiUrl));
        _changes = platform.userChanges.listen((change) => _addLog('$change'));
        setState(() => _platform = platform);
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
            ],
          ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.only(top: 16),
              child: LinearProgressIndicator(),
            ),
          const Divider(height: 32),
          Text('Log', style: Theme.of(context).textTheme.titleMedium),
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