import 'package:flutter/material.dart';
import '../../services/api_client.dart';
import '../../services/event_logger.dart';
import '../ledger_screen.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController(text: '+254');
  final _pinController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    EventLogger.instance.screenView('LoginScreen');
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    EventLogger.instance.userAction('tap_login');
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ApiClient.instance.login(phone: _phoneController.text.trim(), pin: _pinController.text.trim());
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LedgerScreen()));
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('Fungu', style: TextStyle(fontSize: 36, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                const Text('Track a debt between friends. Keep the friendship.', style: TextStyle(fontSize: 14)),
                const SizedBox(height: 32),
                TextFormField(
                  controller: _phoneController,
                  decoration: const InputDecoration(labelText: 'Phone number'),
                  keyboardType: TextInputType.phone,
                  validator: (v) => (v == null || !RegExp(r'^\+254\d{9}$').hasMatch(v))
                      ? 'Format: +254712345678'
                      : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _pinController,
                  decoration: const InputDecoration(labelText: 'PIN'),
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  validator: (v) => (v == null || v.length < 4) ? 'At least 4 digits' : null,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: _loading ? null : _submit,
                  child: _loading
                      ? const SizedBox(
                          height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Log in'),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => Navigator.of(context)
                      .push(MaterialPageRoute(builder: (_) => const RegisterScreen())),
                  child: const Text('New here? Create an account'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
