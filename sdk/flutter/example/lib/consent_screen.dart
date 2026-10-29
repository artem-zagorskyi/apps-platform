import 'package:flutter/material.dart';

/// The person's choice on the consent screen
typedef ConsentChoice = ({bool analytics, bool personalization});

/// Example consent screen. A real app writes its own texts and links its
/// privacy policy. Nothing is pre-selected, rejecting is as easy as
/// accepting, and the screen must be answered.
class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool _analytics = false;
  bool _personalization = false;

  void _close({required bool analytics, required bool personalization}) {
    Navigator.pop<ConsentChoice>(
      context,
      (analytics: analytics, personalization: personalization),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Dialog.fullscreen(
      // An answer is required: the back gesture does not close it
      child: PopScope(
        canPop: false,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Your privacy'),
            automaticallyImplyLeading: false,
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'We would like to collect usage data to improve the app and to '
                'tailor content to you. You can change this at any time in settings.',
              ),
              const SizedBox(height: 16),
              SwitchListTile(
                title: const Text('Analytics'),
                subtitle: const Text('How the app is used: screens, actions, sessions, device details'),
                value: _analytics,
                onChanged: (value) => setState(() => _analytics = value),
              ),
              SwitchListTile(
                title: const Text('Personalization'),
                subtitle: const Text('Content and offers based on how you use the app'),
                value: _personalization,
                onChanged: (value) => setState(() => _personalization = value),
              ),
            ],
          ),
          bottomNavigationBar: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FilledButton(
                    onPressed: () => _close(analytics: true, personalization: true),
                    child: const Text('Accept all'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => _close(
                      analytics: _analytics,
                      personalization: _personalization,
                    ),
                    child: const Text('Save my choices'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: () => _close(analytics: false, personalization: false),
                    child: const Text('Reject all'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}