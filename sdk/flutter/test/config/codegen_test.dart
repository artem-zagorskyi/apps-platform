import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/config/codegen.dart';
import 'package:renvix_sdk/src/config/parameter_schema.dart';

const _schema = r'''
parameters:
  paywall_variant:
    type: enum
    values: [classic, trial_first, default]
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
    max_length: 64
    default: Let's go for $5
  old_banner:
    type: boolean
    default: false
    deprecated: true
''';

String _generate({String className = 'AppConfig', String schema = _schema}) => generateConfigDart(
      parseParameterSchema(schema),
      className: className,
      sourceName: 'remote_config.yaml',
    );

void main() {
  test('generates a typed getter per parameter', () {
    final code = _generate();

    expect(
      code,
      contains("int get dailyGoalMinutes => _source.readInt('daily_goal_minutes', defaultValue: 10, min: 5, max: 60);"),
    );
    expect(code, contains("bool get adsEnabled => _source.readBool('ads_enabled', defaultValue: true);"));
    expect(
      code,
      contains(
        "double get rewardMultiplier => _source.readNumber('reward_multiplier', "
        'defaultValue: 1.0, min: 0.5, max: 3.0);',
      ),
    );
    expect(code, contains('class AppConfig {'));
    expect(code, contains('final ConfigSource _source;'));
  });

  test('escapes string defaults', () {
    expect(_generate(), contains(r"defaultValue: 'Let\'s go for \$5', maxLength: 64);"));
  });

  test('generates enums with wire names and a fallback to the default', () {
    final code = _generate();

    expect(code, contains('enum PaywallVariant {'));
    expect(code, contains("trialFirst('trial_first')"));
    expect(code, contains("defaultValue('default')"));
    expect(code, contains('PaywallVariant get paywallVariant {'));
    expect(code, contains("values: const ['classic', 'trial_first', 'default']"));
    expect(code, contains('orElse: () => PaywallVariant.classic,'));
  });

  test('keeps deprecated parameters with an annotation', () {
    final code = _generate();

    expect(code, contains("@Deprecated('Deprecated in the parameter schema')\n  bool get oldBanner"));
  });

  test('avoids names of dart:core types and of the generated class', () {
    const schema = '''
parameters:
  string:
    type: enum
    values: [a, b]
    default: a
''';

    expect(_generate(schema: schema), contains('enum StringValue {'));
    expect(
      () => _generate(schema: schema.replaceFirst('string:', 'app_config:')),
      throwsA(isA<ParameterSchemaException>()),
    );
  });
}