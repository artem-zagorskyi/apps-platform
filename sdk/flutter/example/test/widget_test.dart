import 'package:flutter_test/flutter_test.dart';
import 'package:renvix_sdk_example/main.dart';

void main() {
  testWidgets('shows the SDK version', (tester) async {
    await tester.pumpWidget(const DemoApp());

    expect(find.text('SDK version 0.1.0'), findsOneWidget);
  });
}