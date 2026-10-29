import 'package:yaml/yaml.dart';

import 'event_tracker.dart';

enum PropertyType {
  boolean('boolean'),
  integer('integer'),
  number('number'),
  string('string'),
  enumeration('enum');

  const PropertyType(this.wireName);

  /// Name in the plan
  final String wireName;
}

class PropertyDefinition {
  const PropertyDefinition({
    required this.name,
    required this.type,
    required this.required,
    required this.deprecated,
    this.description,
    this.maxLength,
    this.min,
    this.max,
    this.values = const [],
  });

  final String name;
  final PropertyType type;
  final bool required;
  final bool deprecated;
  final String? description;
  final int? maxLength;
  final num? min;
  final num? max;
  final List<String> values;

  // Same keys as the YAML plan, so the JSON can be read back by the same parser
  Map<String, Object?> toJson() => {
        'type': type.wireName,
        'required': required,
        if (deprecated) 'deprecated': true,
        'description': ?description,
        'max_length': ?maxLength,
        'min': ?min,
        'max': ?max,
        if (values.isNotEmpty) 'values': values,
      };
}

class EventDefinition {
  const EventDefinition({
    required this.name,
    required this.category,
    required this.description,
    required this.deprecated,
    required this.properties,
  });

  final String name;
  final EventCategory category;
  final String description;
  final bool deprecated;
  final List<PropertyDefinition> properties;

  Map<String, Object?> toJson() => {
        'category': category.name,
        'description': description,
        if (deprecated) 'deprecated': true,
        'properties': {for (final p in properties) p.name: p.toJson()},
      };
}

class TrackingPlan {
  const TrackingPlan(this.events);

  static const formatVersion = 1;

  final List<EventDefinition> events;

  Map<String, Object?> toJson() => {
        'format_version': formatVersion,
        'events': {for (final e in events) e.name: e.toJson()},
      };
}

class TrackingPlanException implements Exception {
  TrackingPlanException(this.errors);

  final List<String> errors;

  @override
  String toString() => 'Invalid tracking plan:\n${errors.map((e) => '  - $e').join('\n')}';
}

final _namePattern = RegExp(r'^[a-z][a-z0-9]*(_[a-z0-9]+)*$');
const _maxNameLength = 64;
const _maxStringLength = 128;

bool _isName(Object? value) =>
    value is String && value.length <= _maxNameLength && _namePattern.hasMatch(value);

void _checkKeys(Map<Object?, Object?> map, Set<String> allowed, String path, List<String> errors) {
  for (final key in map.keys) {
    if (!allowed.contains(key)) {
      errors.add('$path: unknown key "$key" (allowed: ${allowed.join(', ')})');
    }
  }
}

bool _readFlag(Map<Object?, Object?> map, String key, bool fallback, String path, List<String> errors) {
  final value = map[key] ?? fallback;
  if (value is bool) return value;
  errors.add('$path.$key: must be true or false');
  return fallback;
}

/// Parses and validates a tracking plan (YAML, or the normalized JSON).
/// Throws TrackingPlanException listing every problem found.
TrackingPlan parseTrackingPlan(
  String source, {
  Set<String> reservedEventNames = const {},
}) {
  final Object? root;
  try {
    root = loadYaml(source);
  } on YamlException catch (e) {
    throw TrackingPlanException(['Invalid YAML: ${e.message}']);
  }

  if (root is! Map<Object?, Object?>) {
    throw TrackingPlanException(['The plan must be a map with an "events" key']);
  }

  final errors = <String>[];
  _checkKeys(root, {'events', 'format_version'}, 'plan', errors);

  final rawEvents = root['events'];
  if (rawEvents is! Map<Object?, Object?> || rawEvents.isEmpty) {
    throw TrackingPlanException([...errors, 'events: must be a non-empty map']);
  }

  final events = <EventDefinition>[];
  for (final entry in rawEvents.entries) {
    final name = entry.key;
    final path = 'events.$name';

    if (!_isName(name)) {
      errors.add('$path: event names are snake_case, at most $_maxNameLength characters');
      continue;
    }
    name as String;
    if (reservedEventNames.contains(name)) {
      errors.add('$path: "$name" is a standard platform event');
      continue;
    }

    final event = _parseEvent(name, entry.value, path, errors);
    if (event != null) events.add(event);
  }

  if (errors.isNotEmpty) throw TrackingPlanException(errors);
  return TrackingPlan(events);
}

EventDefinition? _parseEvent(String name, Object? raw, String path, List<String> errors) {
  if (raw is! Map<Object?, Object?>) {
    errors.add('$path: must be a map');
    return null;
  }
  _checkKeys(raw, {'category', 'description', 'deprecated', 'properties'}, path, errors);

  final category = switch (raw['category']) {
    'essential' => EventCategory.essential,
    'analytics' => EventCategory.analytics,
    _ => null,
  };
  if (category == null) errors.add('$path.category: must be essential or analytics');

  final description = raw['description'];
  if (description is! String || description.trim().isEmpty) {
    errors.add('$path.description: required');
  }

  final deprecated = _readFlag(raw, 'deprecated', false, path, errors);

  final rawProperties = raw['properties'] ?? <Object?, Object?>{};
  final properties = <PropertyDefinition>[];
  if (rawProperties is! Map<Object?, Object?>) {
    errors.add('$path.properties: must be a map');
  } else {
    for (final entry in rawProperties.entries) {
      final propertyName = entry.key;
      final propertyPath = '$path.properties.$propertyName';
      if (!_isName(propertyName)) {
        errors.add('$propertyPath: property names are snake_case, at most $_maxNameLength characters');
        continue;
      }
      final property = _parseProperty(propertyName as String, entry.value, propertyPath, errors);
      if (property != null) properties.add(property);
    }
  }

  if (category == null || description is! String) return null;
  return EventDefinition(
    name: name,
    category: category,
    description: description.trim(),
    deprecated: deprecated,
    properties: properties,
  );
}

PropertyDefinition? _parseProperty(String name, Object? raw, String path, List<String> errors) {
  if (raw is! Map<Object?, Object?>) {
    errors.add('$path: must be a map');
    return null;
  }

  final type = PropertyType.values.where((t) => t.wireName == raw['type']).firstOrNull;
  if (type == null) {
    errors.add('$path.type: must be one of boolean, integer, number, string, enum');
    return null;
  }

  // Keys that make sense for this type only
  final typeKeys = switch (type) {
    PropertyType.string => {'max_length'},
    PropertyType.integer || PropertyType.number => {'min', 'max'},
    PropertyType.enumeration => {'values'},
    PropertyType.boolean => <String>{},
  };
  _checkKeys(raw, {'type', 'description', 'required', 'deprecated', ...typeKeys}, path, errors);

  final required = _readFlag(raw, 'required', true, path, errors);
  final deprecated = _readFlag(raw, 'deprecated', false, path, errors);

  final description = raw['description'];
  if (description != null && description is! String) {
    errors.add('$path.description: must be text');
  }

  int? maxLength;
  num? min;
  num? max;
  var values = const <String>[];

  switch (type) {
    case PropertyType.string:
      final value = raw['max_length'];
      if (value is! int || value < 1 || value > _maxStringLength) {
        errors.add('$path.max_length: required for strings, from 1 to $_maxStringLength');
      } else {
        maxLength = value;
      }
      // Strings must say what they hold: no free text typed by the person
      if (description is! String || description.trim().isEmpty) {
        errors.add('$path.description: required for strings');
      }

    case PropertyType.integer || PropertyType.number:
      min = _readBound(raw['min'], type, '$path.min', errors);
      max = _readBound(raw['max'], type, '$path.max', errors);
      if (min != null && max != null && min > max) {
        errors.add('$path: min is greater than max');
      }

    case PropertyType.enumeration:
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

    case PropertyType.boolean:
      break;
  }

  return PropertyDefinition(
    name: name,
    type: type,
    required: required,
    deprecated: deprecated,
    description: description is String ? description.trim() : null,
    maxLength: maxLength,
    min: min,
    max: max,
    values: values,
  );
}

num? _readBound(Object? value, PropertyType type, String path, List<String> errors) {
  if (value == null) return null;
  if (type == PropertyType.integer && value is int) return value;
  if (type == PropertyType.number && value is num) return value;
  errors.add('$path: must be ${type == PropertyType.integer ? 'an integer' : 'a number'}');
  return null;
}

/// Changes that would break app versions already installed on devices.
/// The plan only grows: deprecate instead of removing or renaming.
List<String> compatibilityErrors(TrackingPlan previous, TrackingPlan next) {
  final errors = <String>[];
  final nextEvents = {for (final e in next.events) e.name: e};

  for (final old in previous.events) {
    final path = 'events.${old.name}';
    final current = nextEvents[old.name];
    if (current == null) {
      errors.add('$path: removed; mark it deprecated instead');
      continue;
    }
    if (current.category != old.category) {
      errors.add('$path.category: changed from ${old.category.name} to ${current.category.name}');
    }

    final currentProperties = {for (final p in current.properties) p.name: p};
    for (final oldProperty in old.properties) {
      final propertyPath = '$path.properties.${oldProperty.name}';
      final property = currentProperties[oldProperty.name];
      if (property == null) {
        errors.add('$propertyPath: removed; mark it deprecated instead');
        continue;
      }
      if (property.type != oldProperty.type) {
        errors.add('$propertyPath.type: changed from ${oldProperty.type.wireName} to ${property.type.wireName}');
      }
      if (property.required && !oldProperty.required) {
        errors.add('$propertyPath: became required; older app versions do not send it');
      }
      final removedValues = oldProperty.values.where((v) => !property.values.contains(v));
      if (removedValues.isNotEmpty) {
        errors.add('$propertyPath.values: removed ${removedValues.join(', ')}');
      }
    }

    final oldNames = {for (final p in old.properties) p.name};
    for (final property in current.properties) {
      if (!oldNames.contains(property.name) && property.required) {
        errors.add(
          '$path.properties.${property.name}: new properties of an existing event '
          'must be optional (required: false); older app versions do not send them',
        );
      }
    }
  }

  return errors;
}