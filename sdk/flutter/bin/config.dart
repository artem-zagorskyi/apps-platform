import 'dart:io';

import 'package:args/args.dart';
import 'package:renvix_sdk/src/config/codegen.dart';
import 'package:renvix_sdk/src/config/parameter_schema.dart';

/// Generates typed Dart config code and normalized JSON from parameter
/// declarations.
///
/// In an app:
///   dart run renvix_sdk:config remote_config.yaml
///     --dart-out=lib/remote_config.g.dart --json-out=remote_config.json
///
/// An existing JSON output is the previous version of the declarations:
/// changes that would break installed app versions are refused.
void main(List<String> arguments) {
  final parser = ArgParser()
    ..addOption('dart-out', help: 'Generated Dart file', mandatory: true)
    ..addOption('json-out', help: 'Normalized declarations for the server', mandatory: true)
    ..addOption('class', help: 'Name of the generated class', defaultsTo: 'AppConfig');

  final ArgResults args;
  try {
    args = parser.parse(arguments);
  } on FormatException catch (e) {
    _fail('${e.message}\n\n${parser.usage}');
  }
  if (args.rest.length != 1) _fail('Pass exactly one parameter file\n\n${parser.usage}');

  final schemaPath = args.rest.single;
  final dartOut = args.option('dart-out')!;
  final jsonOut = args.option('json-out')!;

  try {
    final schema = parseParameterSchema(File(schemaPath).readAsStringSync());

    final jsonFile = File(jsonOut);
    if (jsonFile.existsSync()) {
      final previous = parseParameterSchema(jsonFile.readAsStringSync());
      final errors = parameterCompatibilityErrors(previous, schema);
      if (errors.isNotEmpty) throw ParameterSchemaException(errors);
    }

    File(dartOut).writeAsStringSync(
      generateConfigDart(
        schema,
        className: args.option('class')!,
        sourceName: Uri.file(schemaPath).pathSegments.last,
      ),
    );
    jsonFile.writeAsStringSync(generateParameterSchemaJson(schema));

    stdout.writeln('Generated ${schema.parameters.length} parameters: $dartOut, $jsonOut');
  } on ParameterSchemaException catch (e) {
    _fail(e.toString());
  } on FileSystemException catch (e) {
    _fail('${e.message}: ${e.path}');
  }
}

Never _fail(String message) {
  stderr.writeln(message);
  exit(1);
}