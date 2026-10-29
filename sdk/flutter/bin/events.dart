import 'dart:io';

import 'package:args/args.dart';
import 'package:renvix_sdk/src/events/codegen.dart';
import 'package:renvix_sdk/src/events/platform_events.g.dart' show platformEventNames;
import 'package:renvix_sdk/src/events/tracking_plan.dart';

/// Generates typed Dart tracking code and normalized JSON from a tracking plan.
///
/// In an app:
///   dart run renvix_sdk:events tracking_plan.yaml
///     --dart-out=lib/events.g.dart --json-out=tracking_plan.json
///
/// The SDK's own standard events (from sdk/flutter):
///   dart run bin/events.dart ../../tracking-plan/platform.yaml --platform
///     --dart-out=lib/src/events/platform_events.g.dart
///     --json-out=../../tracking-plan/platform.json
///
/// An existing JSON output is the previous version of the plan: changes that
/// would break installed app versions are refused.
void main(List<String> arguments) {
  final parser = ArgParser()
    ..addOption('dart-out', help: 'Generated Dart file', mandatory: true)
    ..addOption('json-out', help: 'Normalized plan for the server', mandatory: true)
    ..addOption('class', help: 'Name of the generated class', defaultsTo: 'AppEvents')
    ..addFlag('platform', help: "Generate the SDK's standard events", negatable: false);

  final ArgResults args;
  try {
    args = parser.parse(arguments);
  } on FormatException catch (e) {
    _fail('${e.message}\n\n${parser.usage}');
  }
  if (args.rest.length != 1) _fail('Pass exactly one tracking plan file\n\n${parser.usage}');

  final planPath = args.rest.single;
  final dartOut = args.option('dart-out')!;
  final jsonOut = args.option('json-out')!;
  final isPlatform = args.flag('platform');

  try {
    final plan = parseTrackingPlan(
      File(planPath).readAsStringSync(),
      // App events may not reuse the names of standard events
      reservedEventNames: isPlatform ? const {} : platformEventNames,
    );

    final jsonFile = File(jsonOut);
    if (jsonFile.existsSync()) {
      final previous = parseTrackingPlan(jsonFile.readAsStringSync());
      final errors = compatibilityErrors(previous, plan);
      if (errors.isNotEmpty) throw TrackingPlanException(errors);
    }

    File(dartOut).writeAsStringSync(
      generateDart(
        plan,
        className: isPlatform ? 'PlatformEvents' : args.option('class')!,
        importDirective: isPlatform
            ? "import 'event_tracker.dart';"
            : "import 'package:renvix_sdk/renvix_sdk.dart';",
        sourceName: Uri.file(planPath).pathSegments.last,
        nameSetConstant: isPlatform ? 'platformEventNames' : null,
      ),
    );
    jsonFile.writeAsStringSync(generatePlanJson(plan));

    stdout.writeln('Generated ${plan.events.length} events: $dartOut, $jsonOut');
  } on TrackingPlanException catch (e) {
    _fail(e.toString());
  } on FileSystemException catch (e) {
    _fail('${e.message}: ${e.path}');
  }
}

Never _fail(String message) {
  stderr.writeln(message);
  exit(1);
}