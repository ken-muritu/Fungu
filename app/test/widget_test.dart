import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:fungu/theme.dart';

// Deliberately not testing FunguApp/_AuthGate here: that widget tree hits
// flutter_secure_storage (a platform plugin) via ApiClient.isLoggedIn,
// which isn't mocked in a plain `flutter test` environment and would be an
// untested risk to introduce sight-unseen. This just confirms the app's
// theme builds into a valid MaterialApp — a real, if minimal, smoke test
// that has no platform-channel dependency to fail on.
void main() {
  testWidgets('Themed MaterialApp renders', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: funguTheme(),
      home: const Scaffold(body: Text('Fungu')),
    ));
    expect(find.text('Fungu'), findsOneWidget);
  });
}
