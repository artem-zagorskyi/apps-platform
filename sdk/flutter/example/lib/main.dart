import 'package:flutter/material.dart';
import 'package:renvix_sdk/renvix_sdk.dart';

void main() {
  runApp(const DemoApp());
}

/// Test bench for the SDK: shows its state and triggers every flow.
class DemoApp extends StatelessWidget {
  const DemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Renvix SDK demo',
      theme: ThemeData(colorSchemeSeed: Colors.indigo),
      home: const DemoHomePage(),
    );
  }
}

class DemoHomePage extends StatelessWidget {
  const DemoHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Renvix SDK demo')),
      body: const Center(child: Text('SDK version $sdkVersion')),
    );
  }
}