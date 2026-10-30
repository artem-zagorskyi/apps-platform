import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/config/codegen.dart';
import 'package:renvix_sdk/src/config/parameter_schema.dart';

const _schema = '''
parameters:
  paywall_variant:
    type: enum
    values: [classic, trial_first]
    default: classic
    description: Which paywall layout to show
  daily_goal_minutes:
    type: integer
    min: 5
    max: 60
    default: 10
  ads_enabled:
    type: boolean
    default: true
  reward_multiplier:
    type: number
    min: 0.5
    max: 3
    default: 1
  start_button_text:
    type: string
    max_length: 32
    default: Let's go
''';

Matcher _errors(List<String> expected) =>
    throwsA(isA<ParameterSchemaException>().having((e) => e.errors, 'errors', containsAll(expected)));

void main() {
  test('normalizes to the format the server expects', () {
    expect(parseParameterSchema(_schema).toJson(), {
      'format_version': 1,
      'parameters': {
        'paywall_variant': {
          'type': 'enum',
          'description': 'Which paywall layout to show',
          'default': 'classic',
          'values': ['classic', 'trial_first'],
        },
        'daily_goal_minutes': {'type': 'integer', 'default': 10, 'min': 5, 'max': 60},
        'ads_enabled': {'type': 'boolean', 'default': true},
        'reward_multiplier': {'type': 'number', 'default': 1, 'min': 0.5, 'max': 3},
        'start_button_text': {'type': 'string', 'default': "Let's go", 'max_length': 32},
      },
    });
  });

  test('reads its own JSON back', () {
    final schema = parseParameterSchema(_schema);

    expect(parseParameterSchema(generateParameterSchemaJson(schema)).toJson(), schema.toJson());
  });

  test('reports every problem at once', () {
    const broken = '''
parameters:
  dailyGoal:
    type: integer
    default: 1
  goal:
    type: integer
    min: 10
    max: 5
    default: 7
  text:
    type: string
    default: hi
  variant:
    type: enum
    values: [a, a]
    default: b
  flag:
    type: boolean
  speed:
    type: number
    default: .nan
''';

    expect(
      () => parseParameterSchema(broken),
      _errors([
        'parameters.dailyGoal: names are snake_case, at most 64 characters',
        'parameters.goal: min is greater than max',
        'parameters.goal.default: below min (10)',
        'parameters.text.max_length: required for strings, from 1 to 1024',
        'parameters.variant.values: "a" is listed twice',
        'parameters.variant.default: must be one of a',
        'parameters.flag.default: required',
        'parameters.speed.default: must be a finite number',
      ]),
    );
  });

  test('refuses keys of another type', () {
    const schema = '''
parameters:
  flag:
    type: boolean
    default: true
    max_length: 3
''';

    expect(
      () => parseParameterSchema(schema),
      throwsA(
        isA<ParameterSchemaException>().having(
          (e) => e.errors.single,
          'error',
          startsWith('parameters.flag: unknown key "max_length"'),
        ),
      ),
    );
  });

  group('parameterCompatibilityErrors', () {
    final previous = parseParameterSchema(_schema);

    ParameterSchema changed(String from, String to) => parseParameterSchema(_schema.replaceFirst(from, to));

    test('allows new parameters, enum values, defaults and ranges', () {
      final next = parseParameterSchema(
        '${_schema.replaceFirst('[classic, trial_first]', '[classic, trial_first, video]').replaceFirst('max: 60', 'max: 90')}'
        '  streaks_enabled:\n    type: boolean\n    default: false\n',
      );

      expect(parameterCompatibilityErrors(previous, next), isEmpty);
    });

    test('refuses removed parameters, changed types and removed enum values', () {
      expect(
        parameterCompatibilityErrors(previous, changed('  ads_enabled:\n    type: boolean\n    default: true\n', '')),
        ['parameters.ads_enabled: removed; mark it deprecated instead'],
      );
      expect(
        parameterCompatibilityErrors(previous, changed('type: integer', 'type: number')),
        ['parameters.daily_goal_minutes.type: changed from integer to number'],
      );
      expect(
        parameterCompatibilityErrors(previous, changed('[classic, trial_first]', '[classic]')),
        ['parameters.paywall_variant.values: removed trial_first'],
      );
    });
  });
}