import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'theme.dart';
import 'navigation.dart';
import 'services/api_client.dart';
import 'services/event_logger.dart';
import 'screens/auth/login_screen.dart';
import 'screens/ledger_screen.dart';

void main() {
  // Lets ApiClient redirect to the login screen on a 401 from ANYWHERE in
  // the app, not just the one screen that happened to check statusCode
  // itself before. A token expiring mid-action on create-debt or
  // debt-detail previously just showed a raw "Unauthorized" message with
  // no way back to login.
  loginScreenBuilder = () => const LoginScreen();

  // Global error capture — everything inside the widgets/rendering pipeline
  // (FlutterError.onError) and everything outside it, async errors not
  // caught by any try/catch anywhere in the app (PlatformDispatcher's
  // onError). Without these, a bug that manifests as an uncaught exception
  // would be completely invisible to the logging this session was asked to
  // build — "nothing should be left out" specifically means these too, not
  // just the errors this codebase already anticipated with try/catch.
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    EventLogger.instance.error('FlutterError', details.exceptionAsString(), {
      'library': details.library,
      'context': details.context?.toString(),
    });
  };
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    EventLogger.instance.error('PlatformDispatcher', error.toString());
    return true; // handled — don't crash the app over a logging concern
  };

  EventLogger.instance.appLifecycle('app_open');
  runApp(const FunguApp());
}

class FunguApp extends StatefulWidget {
  const FunguApp({super.key});

  @override
  State<FunguApp> createState() => _FunguAppState();
}

class _FunguAppState extends State<FunguApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    EventLogger.instance.appLifecycle('lifecycle_${state.name}');
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: rootNavigatorKey,
      title: 'Fungu',
      debugShowCheckedModeBanner: false,
      theme: funguTheme(),
      home: const _AuthGate(),
    );
  }
}

/// Routes to the ledger if a token is already stored, otherwise login.
/// Deliberately simple for v1 — no persistent session refresh/expiry UX
/// beyond "log in again if the token stops working" (401s bounce back here
/// via LedgerScreen's error handling).
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: ApiClient.instance.isLoggedIn,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        // On error (a real, documented flutter_secure_storage edge case on
        // some Android devices — encrypted storage keys can be invalidated
        // by certain backup/restore flows), fall back to the login screen
        // rather than hanging on the spinner forever. Worst case someone
        // has to log in again; that's a far better failure than a stuck app.
        final loggedIn = snapshot.hasError ? false : (snapshot.data ?? false);
        if (snapshot.hasError) {
          EventLogger.instance.error('AuthGate', 'isLoggedIn threw', {'error': snapshot.error.toString()});
        }
        return loggedIn ? const LedgerScreen() : const LoginScreen();
      },
    );
  }
}
