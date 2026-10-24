import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000',
);

/// The exact commit this build came from — injected at build time via
/// --dart-define in build-apk.yml / build-web.yml. Every logged event
/// carries this, so a bug report can be traced to the exact code that
/// produced it, not just "the app" in the abstract.
const _appVersion = String.fromEnvironment('APP_VERSION', defaultValue: 'dev');

String get _platform {
  if (kIsWeb) return 'web';
  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
      return 'android';
    case TargetPlatform.iOS:
      return 'ios';
    default:
      return defaultTargetPlatform.name;
  }
}

/// Comprehensive, best-effort usage logging — every screen view, every user
/// action, every network call (wired into ApiClient's _send), every
/// uncaught error. The whole point is tracing what actually happened for a
/// real tester, so nothing here should ever be allowed to break or slow
/// down the feature it's attached to: every send is fire-and-forget, every
/// failure is swallowed silently. A missing log row is an acceptable loss;
/// a crash caused by the logger itself is not.
class EventLogger {
  EventLogger._();
  static final EventLogger instance = EventLogger._();

  // One id per app launch (not persisted) — groups everything from one
  // usage session together server-side, answering "what did this session
  // actually do start to finish" rather than just a pile of loose events.
  final String _sessionId = DateTime.now().microsecondsSinceEpoch.toRadixString(36) +
      (identityHashCode(Object())).toRadixString(36);

  final _storage = const FlutterSecureStorage();
  static const _tokenKey = 'fungu_auth_token'; // must match ApiClient's key

  void _fireAndForget(String eventType, String eventName, [Map<String, dynamic>? detail]) {
    // Deliberately not awaited at any call site — see class doc. Errors
    // inside this async body are caught here so they never become an
    // unhandled-future warning/crash regardless of caller.
    () async {
      try {
        final token = await _storage.read(key: _tokenKey);
        final headers = {'Content-Type': 'application/json'};
        if (token != null) headers['Authorization'] = 'Bearer $token';

        await http
            .post(
              Uri.parse('$_defaultBaseUrl/api/logs'),
              headers: headers,
              body: jsonEncode({
                'sessionId': _sessionId,
                'platform': _platform,
                'appVersion': _appVersion,
                'events': [
                  {'eventType': eventType, 'eventName': eventName, if (detail != null) 'detail': detail},
                ],
              }),
            )
            .timeout(const Duration(seconds: 8));
      } catch (_) {
        // Swallowed on purpose — logging must never surface an error to
        // the user or interfere with the feature that triggered it.
      }
    }();
  }

  void appLifecycle(String name, [Map<String, dynamic>? detail]) => _fireAndForget('app_lifecycle', name, detail);
  void screenView(String screenName) => _fireAndForget('screen_view', screenName);
  void userAction(String actionName, [Map<String, dynamic>? detail]) =>
      _fireAndForget('user_action', actionName, detail);
  void error(String source, String message, [Map<String, dynamic>? detail]) =>
      _fireAndForget('error', source, {'message': message, ...?detail});

  /// Called from ApiClient around every request — covers every network
  /// call the app makes, success or failure, without each call site having
  /// to remember to log it individually.
  void apiCall({
    required String method,
    required String path,
    required bool success,
    int? statusCode,
    required int durationMs,
    String? errorMessage,
  }) {
    _fireAndForget('api_call', '$method $path', {
      'success': success,
      if (statusCode != null) 'statusCode': statusCode,
      'durationMs': durationMs,
      if (errorMessage != null) 'error': errorMessage,
    });
  }
}
