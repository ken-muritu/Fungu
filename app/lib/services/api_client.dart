import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/debt.dart';
import '../models/user.dart';
import '../navigation.dart';
import 'event_logger.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, [this.statusCode]);
  @override
  String toString() => message;
}

/// Points at the Fungu backend (server/ in this repo). Override at build
/// time with `--dart-define=API_BASE_URL=https://your-deployment.vercel.app`
/// — defaults to localhost for local development against `npm run dev`.
const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000',
);

const _requestTimeout = Duration(seconds: 15);

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  final _storage = const FlutterSecureStorage();
  static const _tokenKey = 'fungu_auth_token';

  Future<String?> get _token => _storage.read(key: _tokenKey);

  Future<void> _saveToken(String token) => _storage.write(key: _tokenKey, value: token);

  Future<void> logout() => _storage.delete(key: _tokenKey);

  /// Defensive at the source too, not just at the main.dart call site — a
  /// documented flutter_secure_storage edge case on some Android devices
  /// (Keystore key invalidated by certain backup/restore flows) can throw
  /// here. Treat "can't read storage" the same as "not logged in" rather
  /// than letting the exception propagate to whoever's calling this.
  Future<bool> get isLoggedIn async {
    try {
      return (await _token) != null;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, String>> _headers({bool auth = true}) async {
    final headers = {'Content-Type': 'application/json'};
    if (auth) {
      final token = await _token;
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  /// Every network call goes through here — the single place that turns
  /// real-world failure modes (no signal, DNS hiccup, a slow connection
  /// that never responds, a server that's actually down) into a consistent
  /// ApiException every screen already knows how to display, instead of an
  /// unhandled exception that crashes the operation or leaves a spinner
  /// stuck forever. Matters more than usual for this app specifically —
  /// see BRAINSTORM.md's own market research on patchy mobile connectivity.
  ///
  /// Also the single place every network call gets logged — `label` (e.g.
  /// "POST /api/debts") covers both success and every failure mode below,
  /// so EventLogger sees every request the app makes without each method
  /// having to remember to log itself individually.
  Future<http.Response> _send(String label, Future<http.Response> Function() request) async {
    final stopwatch = Stopwatch()..start();
    try {
      final res = await request().timeout(_requestTimeout);
      EventLogger.instance.apiCall(
        method: label.split(' ').first,
        path: label.split(' ').skip(1).join(' '),
        success: res.statusCode >= 200 && res.statusCode < 300,
        statusCode: res.statusCode,
        durationMs: stopwatch.elapsedMilliseconds,
      );
      return res;
    } on TimeoutException {
      _logApiFailure(label, stopwatch.elapsedMilliseconds, 'timeout');
      throw ApiException('That took too long — check your connection and try again.');
    } on SocketException {
      _logApiFailure(label, stopwatch.elapsedMilliseconds, 'no_connection');
      throw ApiException('No internet connection.');
    } on HttpException {
      _logApiFailure(label, stopwatch.elapsedMilliseconds, 'http_exception');
      throw ApiException('Could not reach Fungu — try again in a moment.');
    } on FormatException {
      _logApiFailure(label, stopwatch.elapsedMilliseconds, 'bad_format');
      throw ApiException('Fungu sent back something unexpected — try again.');
    } on ApiException catch (e) {
      _logApiFailure(label, stopwatch.elapsedMilliseconds, e.message);
      rethrow;
    } catch (e) {
      _logApiFailure(label, stopwatch.elapsedMilliseconds, e.toString());
      throw ApiException('Something went wrong — try again.');
    }
  }

  void _logApiFailure(String label, int durationMs, String errorMessage) {
    EventLogger.instance.apiCall(
      method: label.split(' ').first,
      path: label.split(' ').skip(1).join(' '),
      success: false,
      durationMs: durationMs,
      errorMessage: errorMessage,
    );
  }

  // Guards against firing the redirect more than once if several in-flight
  // requests all 401 around the same time (e.g. a background refresh plus
  // a user-initiated action).
  bool _redirectingToLogin = false;

  dynamic _decode(http.Response res) {
    Map<String, dynamic> body;
    try {
      body = res.body.isEmpty ? {} : jsonDecode(res.body) as Map<String, dynamic>;
    } on FormatException {
      throw ApiException('Fungu sent back something unexpected — try again.');
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;

    // A 401 on an AUTHENTICATED call means the session token itself is
    // invalid/expired — bounce to login from wherever the user happens to
    // be, not just when the ledger screen notices. Login/register's own
    // "wrong PIN"/validation 401s are deliberately excluded (they're not
    // authenticated calls in the first place, identifiable by path) —
    // redirecting away from the login screen because of a wrong PIN would
    // be exactly the wrong behavior.
    final path = res.request?.url.path ?? '';
    final isAuthEndpoint = path.endsWith('/api/auth/login') || path.endsWith('/api/auth/register');
    if (res.statusCode == 401 && !isAuthEndpoint && !_redirectingToLogin) {
      _redirectingToLogin = true;
      EventLogger.instance.appLifecycle('session_expired_redirect');
      logout().then((_) {
        final nav = rootNavigatorKey.currentState;
        final builder = loginScreenBuilder;
        if (nav != null && builder != null) {
          nav.pushAndRemoveUntil(MaterialPageRoute(builder: (_) => builder()), (route) => false);
        }
        _redirectingToLogin = false;
      });
    }

    final message = body['error'] != null
        ? (body['error'] is String ? body['error'] : jsonEncode(body['error']))
        : 'Request failed (${res.statusCode})';
    throw ApiException(message, res.statusCode);
  }

  Future<FunguUser> register({required String phone, required String name, required String pin}) async {
    final res = await _send('POST /api/auth/register', () async => http.post(
          Uri.parse('$_defaultBaseUrl/api/auth/register'),
          headers: await _headers(auth: false),
          body: jsonEncode({'phone': phone, 'name': name, 'pin': pin}),
        ));
    final data = _decode(res);
    await _saveToken(data['token']);
    return FunguUser.fromJson(data['user']);
  }

  Future<FunguUser> login({required String phone, required String pin}) async {
    final res = await _send('POST /api/auth/login', () async => http.post(
          Uri.parse('$_defaultBaseUrl/api/auth/login'),
          headers: await _headers(auth: false),
          body: jsonEncode({'phone': phone, 'pin': pin}),
        ));
    final data = _decode(res);
    await _saveToken(data['token']);
    return FunguUser.fromJson(data['user']);
  }

  Future<List<Debt>> listDebts() async {
    final res = await _send(
        'GET /api/debts', () async => http.get(Uri.parse('$_defaultBaseUrl/api/debts'), headers: await _headers()));
    final data = _decode(res);
    return (data['debts'] as List).map((d) => Debt.fromJson(d)).toList();
  }

  Future<String> createDebt({
    required String borrowerPhone,
    required double amountKes,
    required String purpose,
    required DateTime dueDate,
    // Caller generates this ONCE per create-debt attempt (see
    // CreateDebtScreen — one per screen instance, stable across retries of
    // the same submission) and must resend the same value if it retries.
    // Real incident this fixes: a request took 14-15s (Vercel cold-start +
    // Turso latency), the client's 15s timeout gave up, a retry fired, and
    // the server had actually already created the debt the first time —
    // two identical debts landed in production. The server now treats a
    // repeated idempotencyKey as "already done", returning the original
    // debt's id instead of creating a second one.
    required String idempotencyKey,
  }) async {
    final res = await _send('POST /api/debts', () async => http.post(
          Uri.parse('$_defaultBaseUrl/api/debts'),
          headers: await _headers(),
          body: jsonEncode({
            'borrowerPhone': borrowerPhone,
            'amountKes': amountKes,
            'purpose': purpose,
            // showDatePicker returns a local DateTime; .toIso8601String() on
            // a non-UTC DateTime omits the 'Z' suffix, which the server's
            // zod schema (z.string().datetime(), UTC-only by default)
            // rejects outright — every debt creation would 400. A plain
            // .toUtc() would "fix" the validation but shift the calendar
            // day by the device's UTC offset (e.g. picking Sep 15 in
            // Nairobi becomes Sep 14 21:00 UTC). Due dates are a calendar
            // day, not a precise instant, so construct UTC midnight
            // directly from the picked Y/M/D — same day everywhere,
            // no ambiguity, satisfies the server's format requirement.
            'dueDate': DateTime.utc(dueDate.year, dueDate.month, dueDate.day).toIso8601String(),
            'checklistCanAfford': true,
            'checklistKnowsConsequences': true,
            'idempotencyKey': idempotencyKey,
          }),
        ));
    final data = _decode(res);
    return data['id'];
  }

  Future<Map<String, dynamic>> getDebtDetail(String id) async {
    final res = await _send('GET /api/debts/[id]',
        () async => http.get(Uri.parse('$_defaultBaseUrl/api/debts/$id'), headers: await _headers()));
    return _decode(res);
  }

  Future<void> inviteGuarantor(String debtId, String guarantorPhone) async {
    final res = await _send('POST /api/debts/[id]/guarantor', () async => http.post(
          Uri.parse('$_defaultBaseUrl/api/debts/$debtId/guarantor'),
          headers: await _headers(),
          body: jsonEncode({'guarantorPhone': guarantorPhone}),
        ));
    _decode(res);
  }

  Future<void> respondToGuarantorInvite(String debtId, bool accept) async {
    final res = await _send('PATCH /api/debts/[id]/guarantor', () async => http.patch(
          Uri.parse('$_defaultBaseUrl/api/debts/$debtId/guarantor'),
          headers: await _headers(),
          body: jsonEncode({'response': accept ? 'accepted' : 'declined'}),
        ));
    _decode(res);
  }

  Future<String> makeRepayment(String debtId, {required double amountKes, required String method}) async {
    final res = await _send('POST /api/debts/[id]/repayments', () async => http.post(
          Uri.parse('$_defaultBaseUrl/api/debts/$debtId/repayments'),
          headers: await _headers(),
          body: jsonEncode({'amountKes': amountKes, 'method': method}),
        ));
    final data = _decode(res);
    return data['status'];
  }
}
