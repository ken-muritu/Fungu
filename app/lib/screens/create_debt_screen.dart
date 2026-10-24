import 'package:flutter/material.dart';
import '../services/api_client.dart';
import '../services/event_logger.dart';
import '../theme.dart';

/// Two steps: enter the debt, then the pre-agreement checklist. The
/// checklist is not skippable — see MVP-PRD.md §4: "the moment most likely
/// to actually change behavior (catching a bad loan before it's made, not
/// after)." An optional guarantor can be added on the checklist step too.
class CreateDebtScreen extends StatefulWidget {
  const CreateDebtScreen({super.key});

  @override
  State<CreateDebtScreen> createState() => _CreateDebtScreenState();
}

class _CreateDebtScreenState extends State<CreateDebtScreen> {
  int _step = 0;

  final _detailsFormKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController(text: '+254');
  final _amountController = TextEditingController();
  final _purposeController = TextEditingController();
  DateTime? _dueDate;

  bool _canAfford = false;
  bool _knowsConsequences = false;
  bool _addGuarantor = false;
  final _guarantorPhoneController = TextEditingController();

  bool _loading = false;
  String? _error;

  // One per screen instance, stable across any retry of the same
  // submission — see ApiClient.createDebt's doc comment for the real
  // duplicate-debt incident this prevents. Navigating away and back gets a
  // fresh key, correctly treated as a new attempt.
  final String _idempotencyKey =
      '${DateTime.now().microsecondsSinceEpoch}-${identityHashCode(Object())}';

  @override
  void initState() {
    super.initState();
    EventLogger.instance.screenView('CreateDebtScreen');
  }

  void _goToChecklist() {
    if (!_detailsFormKey.currentState!.validate()) return;
    if (_dueDate == null) {
      setState(() => _error = 'Pick a due date');
      return;
    }
    EventLogger.instance.userAction('create_debt_step1_continue');
    setState(() {
      _error = null;
      _step = 1;
    });
  }

  Future<void> _create() async {
    if (!_canAfford || !_knowsConsequences) {
      setState(() => _error = 'Both checklist items need to be checked to continue');
      return;
    }
    EventLogger.instance.userAction('tap_create_debt', {'withGuarantor': _addGuarantor});
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final debtId = await ApiClient.instance.createDebt(
        borrowerPhone: _phoneController.text.trim(),
        amountKes: double.parse(_amountController.text.trim()),
        purpose: _purposeController.text.trim(),
        dueDate: _dueDate!,
        idempotencyKey: _idempotencyKey,
      );
      if (_addGuarantor && _guarantorPhoneController.text.trim().isNotEmpty) {
        await ApiClient.instance.inviteGuarantor(debtId, _guarantorPhoneController.text.trim());
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_step == 0 ? 'New debt' : 'Before you continue')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _step == 0 ? _buildDetailsStep() : _buildChecklistStep(),
        ),
      ),
    );
  }

  Widget _buildDetailsStep() {
    return Form(
      key: _detailsFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _phoneController,
            decoration: const InputDecoration(labelText: "Their phone number"),
            keyboardType: TextInputType.phone,
            validator: (v) =>
                (v == null || !RegExp(r'^\+254\d{9}$').hasMatch(v)) ? 'Format: +254712345678' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _amountController,
            decoration: const InputDecoration(labelText: 'Amount (KES)'),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            validator: (v) {
              final n = double.tryParse(v ?? '');
              return (n == null || n <= 0) ? 'Enter a valid amount' : null;
            },
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _purposeController,
            decoration: const InputDecoration(labelText: 'What is it for?'),
            maxLength: 280,
            validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
          ),
          const SizedBox(height: 4),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(_dueDate == null ? 'Pick a due date' : 'Due ${_dueDate!.toLocal()}'.split(' ').first),
            trailing: const Icon(Icons.calendar_today, size: 18),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
                initialDate: DateTime.now().add(const Duration(days: 30)),
              );
              if (picked != null) setState(() => _dueDate = picked);
            },
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 20),
          ElevatedButton(onPressed: _goToChecklist, child: const Text('Continue')),
        ],
      ),
    );
  }

  Widget _buildChecklistStep() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'A quick check before this becomes a debt between you two — '
            'modeled on the responsible-borrowing checklist Co-op Bank Foundation teaches.',
            style: TextStyle(color: FunguColors.textSecondary),
          ),
          const SizedBox(height: 20),
          CheckboxListTile(
            value: _canAfford,
            onChanged: (v) => setState(() => _canAfford = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text('I can actually afford to lend this, even if it comes back late'),
          ),
          CheckboxListTile(
            value: _knowsConsequences,
            onChanged: (v) => setState(() => _knowsConsequences = v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            title: const Text("We've talked about what happens if a payment is missed"),
          ),
          const Divider(height: 32),
          SwitchListTile(
            value: _addGuarantor,
            onChanged: (v) => setState(() => _addGuarantor = v),
            contentPadding: EdgeInsets.zero,
            title: const Text('Add a guarantor (optional)'),
            subtitle: const Text('They see the terms and can accept or decline.'),
          ),
          if (_addGuarantor) ...[
            const SizedBox(height: 8),
            TextFormField(
              controller: _guarantorPhoneController,
              decoration: const InputDecoration(labelText: "Guarantor's phone number"),
              keyboardType: TextInputType.phone,
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Colors.red)),
          ],
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loading ? null : _create,
            child: _loading
                ? const SizedBox(
                    height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Create debt'),
          ),
          TextButton(onPressed: () => setState(() => _step = 0), child: const Text('Back')),
        ],
      ),
    );
  }
}
