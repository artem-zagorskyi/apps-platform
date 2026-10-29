import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/events/codegen.dart';
import 'package:renvix_sdk/src/events/tracking_plan.dart';

const _plan = '''
events:
  lesson_completed:
    category: analytics
    description: The person finished a lesson
    properties:
      lesson_id:
        type: string
        max_length: 64
        description: Lesson identifier
      result:
        type: enum
        values: [passed, failed, default]
      duration_seconds:
        type: number
        required: false
      old_score:
        type: integer
        required: false
        deprecated: true
  app_rated:
    category: essential
    description: The person rated the app
''';

String _generate({String? nameSet}) => generateDart(
      parseTrackingPlan(_plan),
      className: 'AppEvents',
      importDirective: "import 'package:renvix_sdk/renvix_sdk.dart';",
      sourceName: 'tracking_plan.yaml',
      nameSetConstant: nameSet,
    );

void main() {
  test('generates a typed method per event', () {
    final code = _generate();

    expect(code, contains('void lessonCompleted({'));
    expect(code, contains('required String lessonId,'));
    expect(code, contains('required LessonCompletedResult result,'));
    expect(code, contains('num? durationSeconds,'));
    expect(code, contains("_tracker.track('lesson_completed', EventCategory.analytics, {"));
    expect(code, contains("'result': result.wireName,"));
    expect(code, contains("'duration_seconds': ?durationSeconds,"));
    expect(code, contains("_tracker.track('app_rated', EventCategory.essential, const {});"));
  });

  test('generates enums with wire names and avoids Dart keywords', () {
    final code = _generate();

    expect(code, contains('enum LessonCompletedResult {'));
    expect(code, contains("passed('passed')"));
    expect(code, contains("defaultValue('default')"));
  });

  test('leaves deprecated properties out of new code', () {
    expect(_generate(), isNot(contains('oldScore')));
  });

  test('lists event names when asked', () {
    final code = _generate(nameSet: 'platformEventNames');

    expect(code, contains('const Set<String> platformEventNames = {'));
    expect(code, contains("  'app_rated',"));
  });
}