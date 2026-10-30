import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/renvix_sdk.dart';

void main() {
  const values = ConfigValues({
    'ads_enabled': false,
    'daily_goal_minutes': 15,
    'reward_multiplier': 2,
    'start_button_text': 'Go',
    'paywall_variant': 'trial_first',
  });

  test('returns server values that fit', () {
    expect(values.readBool('ads_enabled', defaultValue: true), isFalse);
    expect(values.readInt('daily_goal_minutes', defaultValue: 10, min: 5, max: 60), 15);
    // JSON integers are valid numbers
    expect(values.readNumber('reward_multiplier', defaultValue: 1, max: 3), 2.0);
    expect(values.readString('start_button_text', defaultValue: 'Start', maxLength: 8), 'Go');
    expect(
      values.readEnum('paywall_variant', defaultValue: 'classic', values: ['classic', 'trial_first']),
      'trial_first',
    );
  });

  test('falls back to the default when a value does not fit this app version', () {
    expect(values.readInt('daily_goal_minutes', defaultValue: 10, max: 12), 10);
    expect(values.readString('start_button_text', defaultValue: 'Start', maxLength: 1), 'Start');
    // A value added in a newer app version
    expect(values.readEnum('paywall_variant', defaultValue: 'classic', values: ['classic']), 'classic');
    // Wrong type
    expect(values.readBool('daily_goal_minutes', defaultValue: true), isTrue);
    expect(values.readInt('reward_multiplier', defaultValue: 1), 2);
    expect(const ConfigValues({'goal': 1.5}).readInt('goal', defaultValue: 1), 1);
  });

  test('falls back to the default without a value', () {
    expect(ConfigValues.empty.readBool('ads_enabled', defaultValue: true), isTrue);
    expect(ConfigValues.empty.readNumber('reward_multiplier', defaultValue: 1.5), 1.5);
  });
}