import 'package:yaml/yaml.dart';

/// Config strings are written by developers (texts, links); same limit as the server
const maxConfigStringLength = 1024;

enum ParameterType {
  boolean('boolean'),
  integer('integer'),
  number('number'),
  string('string'),
  enumeration('enum');

  const ParameterType(this.wireName);

  /// Name in the schema
  final String wireName;
}

class ParameterDefinition {
  const ParameterDefinition({
    required this.name,
    required this.type,
    required this.defaultValue,
    required this.deprecated,
    this.description,
    this.min,
    this.max,
    this.maxLength,
    this.values = const [],
  });

  final String name;
  final ParameterType type;

  /// bool, int, num or String, matching [type]; checked against the declaration
  final Object defaultValue;
  final bool deprecated;
  final String? description;
  final num? min;
  final num? max;
  final int? maxLength;
  final List<String> values;

  // Same keys as the YAML, so the JSON can be read back by the same parser
  Map<String, Object?> toJson() => {
        'type': type.wireName,
        'description': ?description,
        if (deprecated) 'deprecated': true,
        'default': defaultValue,
        'min': ?min,
        'max': ?max,
        'max_length': ?maxLength,
        if (values.isNotEmpty) 'values': values,
      };
}

class ParameterSchema {
  const ParameterSchema(this.parameters);

  static const formatVersion = 1;

  final List<ParameterDefinition> parameters;

  Map<String, Object?> toJson() => {
        'format_version': formatVersion,
        'parameters': {for (final p in parameters) p.name: p.toJson()},
      };
}

class ParameterSchemaException implements Exception {
  ParameterSchemaException(this.errors);

  final List<String> errors;

  @override
  String toString() => 'Invalid parameter schema:\n${errors.map((e) => '  - $e').join('\n')}';
}

final _namePattern = RegExp(r'^[a-z][a-z0-9]*(_[a-z0-9]+)*$');
const _maxNameLength = 64;

bool _isName(Object? value) =>
    value is String && value.length <= _maxNameLength && _namePattern.hasMatch(value);

void _checkKeys(Map<Object?, Object?> map, Set<String> allowed, String path, List<String> errors) {
  for (final key in map.keys) {
    if (!allowed.contains(key)) {
      errors.add('$path: unknown key "$key" (allowed: ${allowed.join(', ')})');
    }
  }
}

/// Parses and validates parameter declarations (YAML, or the normalized JSON).
/// Throws ParameterSchemaException listing every problem found.
ParameterSchema parseParameterSchema(String source) {
  final Object? root;
  try {
    root = loadYaml(source);
  } on YamlException catch (e) {
    throw ParameterSchemaException(['Invalid YAML: ${e.message}']);
  }

  if (root is! Map<Object?, Object?>) {
    throw ParameterSchemaException(['The schema must be a map with a "parameters" key']);
  }

  final errors = <String>[];
  _checkKeys(root, {'parameters', 'format_version'}, 'schema', errors);

  final rawParameters = root['parameters'];
  if (rawParameters is! Map<Object?, Object?> || rawParameters.isEmpty) {
    throw ParameterSchemaException([...errors, 'parameters: must be a non-empty map']);
  }

  final parameters = <ParameterDefinition>[];
  for (final entry in rawParameters.entries) {
    final name = entry.key;
    final path = 'parameters.$name';
    if (!_isName(name)) {
      errors.add('$path: names are snake_case, at most $_maxNameLength characters');
      continue;
    }
    final parameter = _parseParameter(name as String, entry.value, path, errors);
    if (parameter != null) parameters.add(parameter);
  }

  if (errors.isNotEmpty) throw ParameterSchemaException(errors);
  return ParameterSchema(parameters);
}

ParameterDefinition? _parseParameter(String name, Object? raw, String path, List<String> errors) {
  if (raw is! Map<Object?, Object?>) {
    errors.add('$path: must be a map');
    return null;
  }

  final type = ParameterType.values.where((t) => t.wireName == raw['type']).firstOrNull;
  if (type == null) {
    errors.add('$path.type: must be one of boolean, integer, number, string, enum');
    return null;
  }

  // Keys that make sense for this type only
  final typeKeys = switch (type) {
    ParameterType.string => {'max_length'},
    ParameterType.integer || ParameterType.number => {'min', 'max'},
    ParameterType.enumeration => {'values'},
    ParameterType.boolean => <String>{},
  };
  _checkKeys(raw, {'type', 'description', 'deprecated', 'default', ...typeKeys}, path, errors);

  final description = raw['description'];
  if (description != null && (description is! String || description.trim().isEmpty)) {
    errors.add('$path.description: must be text');
  }
  final deprecated = raw['deprecated'] ?? false;
  if (deprecated is! bool) errors.add('$path.deprecated: must be true or false');

  int? maxLength;
  num? min;
  num? max;
  var values = const <String>[];

  switch (type) {
    case ParameterType.string:
      final value = raw['max_length'];
      if (value is int && value >= 1 && value <= maxConfigStringLength) {
        maxLength = value;
      } else {
        errors.add('$path.max_length: required for strings, from 1 to $maxConfigStringLength');
      }

    case ParameterType.integer || ParameterType.number:
      min = _readBound(raw['min'], type, '$path.min', errors);
      max = _readBound(raw['max'], type, '$path.max', errors);
      if (min != null && max != null && min > max) errors.add('$path: min is greater than max');

    case ParameterType.enumeration:
      final rawValues = raw['values'];
      if (rawValues is! List<Object?> || rawValues.isEmpty) {
        errors.add('$path.values: required for enums, a non-empty list');
      } else {
        final parsed = <String>[];
        for (final value in rawValues) {
          if (!_isName(value)) {
            errors.add('$path.values: "$value" must be snake_case');
          } else if (parsed.contains(value)) {
            errors.add('$path.values: "$value" is listed twice');
          } else {
            parsed.add(value as String);
          }
        }
        values = parsed;
      }

    case ParameterType.boolean:
      break;
  }

  if (!raw.containsKey('default')) {
    errors.add('$path.default: required');
    return null;
  }
  final defaultValue = raw['default'];
  final problem = _valueProblem(type, defaultValue, min: min, max: max, maxLength: maxLength, values: values);
  if (problem != null || defaultValue == null) {
    errors.add('$path.default: ${problem ?? 'required'}');
    return null;
  }

  return ParameterDefinition(
    name: name,
    type: type,
    defaultValue: defaultValue,
    deprecated: deprecated == true,
    description: description is String ? description.trim() : null,
    min: min,
    max: max,
    maxLength: maxLength,
    values: values,
  );
}

num? _readBound(Object? value, ParameterType type, String path, List<String> errors) {
  if (value == null) return null;
  if (type == ParameterType.integer && value is int) return value;
  if (type == ParameterType.number && value is num && value.isFinite) return value;
  errors.add('$path: must be ${type == ParameterType.integer ? 'an integer' : 'a finite number'}');
  return null;
}

String? _valueProblem(
  ParameterType type,
  Object? value, {
  required num? min,
  required num? max,
  required int? maxLength,
  required List<String> values,
}) {
  switch (type) {
    case ParameterType.boolean:
      return value is bool ? null : 'must be true or false';
    case ParameterType.integer:
      return value is int ? _rangeProblem(value, min, max) : 'must be an integer';
    case ParameterType.number:
      // YAML has .nan and .inf; JSON and Dart code cannot hold them
      return value is num && value.isFinite ? _rangeProblem(value, min, max) : 'must be a finite number';
    case ParameterType.string:
      if (value is! String) return 'must be text';
      return maxLength != null && value.length > maxLength ? 'longer than max_length ($maxLength)' : null;
    case ParameterType.enumeration:
      return value is String && values.contains(value) ? null : 'must be one of ${values.join(', ')}';
  }
}

String? _rangeProblem(num value, num? min, num? max) {
  if (min != null && value < min) return 'below min ($min)';
  if (max != null && value > max) return 'above max ($max)';
  return null;
}

/// Changes that would break app versions already installed on devices.
/// Ranges, lengths and defaults may change: each app version checks server
/// values against its own declaration.
List<String> parameterCompatibilityErrors(ParameterSchema previous, ParameterSchema next) {
  final errors = <String>[];
  final current = {for (final p in next.parameters) p.name: p};

  for (final old in previous.parameters) {
    final path = 'parameters.${old.name}';
    final parameter = current[old.name];
    if (parameter == null) {
      errors.add('$path: removed; mark it deprecated instead');
      continue;
    }
    if (parameter.type != old.type) {
      errors.add('$path.type: changed from ${old.type.wireName} to ${parameter.type.wireName}');
      continue;
    }
    final removed = old.values.where((v) => !parameter.values.contains(v)).toList();
    if (removed.isNotEmpty) errors.add('$path.values: removed ${removed.join(', ')}');
  }

  return errors;
}