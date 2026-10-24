import 'package:flutter/material.dart';
import '../../services/api_client.dart';
import '../../services/event_logger.dart';
import '../ledger_screen.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController(text: '+254');
  final _pinController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    EventLogger.instance.screenView('RegisterScreen');
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    EventLogger.instance.userAction('tap_register');
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ApiClient.instance.register(
        phone: _phoneController.text.trim(),
        name: _nameController.text.trim(),
        pin: _pinController.text.trim(),
      );
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
      appBar: AppBar(title: const Text('Create account')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: 'Your name'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: 12),
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
                  decoration: const InputDecoration(labelText: 'Choose a PIN (4-6 digits)'),
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  validator: (v) =>
                      (v == null || !RegExp(r'^\d{4,6}$').hasMatch(v)) ? '4-6 digits' : null,
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
                      : const Text('Create account'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
