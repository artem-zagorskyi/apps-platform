import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk/src/events/codegen.dart';
import 'package:renvix_sdk/src/events/event_tracker.dart';
import 'package:renvix_sdk/src/events/tracking_plan.dart';

const _valid = '''
events:
  lesson_completed:
    category: analytics
    description: The person finished a lesson
    properties:
      lesson_id:
        type: string
        max_length: 64
        description: Lesson identifier
      mistakes:
        type: integer
        min: 0
      result:
        type: enum
        values: [passed, failed]
      duration_seconds:
        type: number
        min: 0
        required: false
''';

// A plan with one event whose properties are given as YAML lines
String _withProperties(String properties) => '''
events:
  lesson_completed:
    category: analytics
    description: The person finished a lesson
    properties:
$properties
''';

List<String> _errorsOf(String yaml, {Set<String> reserved = const {}}) {
  try {
    parseTrackingPlan(yaml, reservedEventNames: reserved);
    return [];
  } on TrackingPlanException catch (e) {
    return e.errors;
  }
}

void main() {
  group('parseTrackingPlan', () {
    test('parses a valid plan', () {
      final event = parseTrackingPlan(_valid).events.single;

      expect(event.name, 'lesson_completed');
      expect(event.category, EventCategory.analytics);
      expect(event.properties.map((p) => p.name), ['lesson_id', 'mistakes', 'result', 'duration_seconds']);
      expect(event.properties[2].values, ['passed', 'failed']);
      expect(event.properties.last.required, isFalse);
      expect(event.properties.last.type, PropertyType.number);
    });

    test('reads back its own normalized JSON', () {
      final plan = parseTrackingPlan(_valid);

      final again = parseTrackingPlan(generatePlanJson(plan));

      expect(again.toJson(), plan.toJson());
    });

    test('rejects event names that are not snake_case', () {
      final errors = _errorsOf(_valid.replaceFirst('lesson_completed', 'LessonCompleted'));

      expect(errors.single, contains('snake_case'));
    });

    test('requires a category and a description', () {
      const yaml = '''
events:
  lesson_completed:
    properties: {}
''';

      final errors = _errorsOf(yaml);

      expect(errors, contains(contains('category')));
      expect(errors, contains(contains('description')));
    });

    test('requires a short max_length and a description for strings', () {
      final errors = _errorsOf(_withProperties('''
      note:
        type: string
        max_length: 500
'''));

      expect(errors, contains(contains('max_length')));
      expect(errors, contains(contains('description: required for strings')));
    });

    test('requires values for enums', () {
      final errors = _errorsOf(_withProperties('''
      result:
        type: enum
'''));

      expect(errors.single, contains('values'));
    });

    test('rejects unknown types and nested data', () {
      final errors = _errorsOf(_withProperties('''
      details:
        type: object
'''));

      expect(errors.single, contains('must be one of'));
    });

    test('rejects unknown keys, including keys of another type', () {
      final errors = _errorsOf(_withProperties('''
      mistakes:
        type: integer
        maxlength: 5
'''));

      expect(errors.single, contains('unknown key "maxlength"'));
    });

    test('rejects min greater than max', () {
      final errors = _errorsOf(_withProperties('''
      mistakes:
        type: integer
        min: 10
        max: 1
'''));

      expect(errors.single, contains('min is greater than max'));
    });

    test('rejects names of standard platform events', () {
      final errors = _errorsOf(_valid, reserved: {'lesson_completed'});

      expect(errors.single, contains('standard platform event'));
    });

    test('lists every problem at once', () {
      const yaml = '''
events:
  Bad:
    category: analytics
    description: x
  lesson_completed:
    category: sometimes
    description: x
''';

      expect(_errorsOf(yaml), hasLength(2));
    });
  });

  group('compatibilityErrors', () {
    final previous = parseTrackingPlan(_valid);

    List<String> check(String next) => compatibilityErrors(previous, parseTrackingPlan(next));

    test('accepts new optional properties and deprecations', () {
      final next = _valid
          .replaceFirst(
            'description: The person finished a lesson',
            'description: The person finished a lesson\n    deprecated: true',
          )
          .replaceFirst('''
      duration_seconds:''', '''
      hints_used:
        type: integer
        required: false
      duration_seconds:''');

      expect(check(next), isEmpty);
    });

    test('refuses a removed event', () {
      const next = '''
events:
  lesson_started:
    category: analytics
    description: The person started a lesson
''';

      expect(check(next).single, contains('removed'));
    });

    test('refuses a removed or retyped property', () {
      final next = _valid
          .replaceFirst('''
      lesson_id:
        type: string
        max_length: 64
        description: Lesson identifier
''', '')
          .replaceFirst('''
      mistakes:
        type: integer''', '''
      mistakes:
        type: number''');

      final errors = check(next);

      expect(errors, contains(contains('lesson_id: removed')));
      expect(errors, contains(contains('mistakes.type: changed')));
    });

    test('refuses a new required property on an existing event', () {
      final next = _valid.replaceFirst('''
      duration_seconds:''', '''
      hints_used:
        type: integer
      duration_seconds:''');

      expect(check(next).single, contains('must be optional'));
    });

    test('refuses removed enum values', () {
      final next = _valid.replaceFirst('[passed, failed]', '[passed]');

      expect(check(next).single, contains('removed failed'));
    });
  });
}