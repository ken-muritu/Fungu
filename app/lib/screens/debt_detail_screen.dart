import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/debt.dart';
import '../services/api_client.dart';
import '../services/event_logger.dart';
import '../theme.dart';

class DebtDetailScreen extends StatefulWidget {
  final String debtId;
  const DebtDetailScreen({super.key, required this.debtId});

  @override
  State<DebtDetailScreen> createState() => _DebtDetailScreenState();
}

class _DebtDetailScreenState extends State<DebtDetailScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _payLoading = false;
  bool _guarantorActionLoading = false;

  @override
  void initState() {
    super.initState();
    EventLogger.instance.screenView('DebtDetailScreen');
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ApiClient.instance.getDebtDetail(widget.debtId);
      setState(() {
        _data = data;
        _error = null;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  Future<void> _pay(double amountKes, String method) async {
    EventLogger.instance.userAction('tap_pay', {'method': method});
    setState(() => _payLoading = true);
    try {
      final status = await ApiClient.instance.makeRepayment(widget.debtId, amountKes: amountKes, method: method);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            method == 'stk_push'
                ? 'Check your phone to enter your M-Pesa PIN'
                : status == 'completed'
                    ? 'Marked as paid'
                    : 'Recorded',
          ),
        ),
      );
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _payLoading = false);
    }
  }

  Future<void> _respondToGuarantor(bool accept) async {
    EventLogger.instance.userAction(accept ? 'tap_accept_guarantor' : 'tap_decline_guarantor');
    setState(() => _guarantorActionLoading = true);
    try {
      await ApiClient.instance.respondToGuarantorInvite(widget.debtId, accept);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(accept ? 'You accepted — thanks for backing this' : 'Declined')));
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _guarantorActionLoading = false);
    }
  }

  Future<void> _showInviteGuarantorSheet() async {
    EventLogger.instance.userAction('tap_invite_guarantor');
    final controller = TextEditingController(text: '+254');
    String? sheetError;
    bool loading = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 24,
            right: 24,
            top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Invite a guarantor', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              const SizedBox(height: 4),
              const Text("They'll see the terms and can accept or decline.",
                  style: TextStyle(color: FunguColors.textSecondary, fontSize: 13)),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: "Guarantor's phone number"),
              ),
              if (sheetError != null) ...[
                const SizedBox(height: 8),
                Text(sheetError!, style: const TextStyle(color: Colors.red)),
              ],
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: loading
                    ? null
                    : () async {
                        final phone = controller.text.trim();
                        if (!RegExp(r'^\+254\d{9}$').hasMatch(phone)) {
                          setSheetState(() => sheetError = 'Format: +254712345678');
                          return;
                        }
                        setSheetState(() {
                          loading = true;
                          sheetError = null;
                        });
                        try {
                          await ApiClient.instance.inviteGuarantor(widget.debtId, phone);
                          if (ctx.mounted) Navigator.of(ctx).pop();
                          await _load();
                        } on ApiException catch (e) {
                          setSheetState(() {
                            loading = false;
                            sheetError = e.message;
                          });
                        }
                      },
                child: loading
                    ? const SizedBox(
                        height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Send invite'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showPaySheet(double remainingKes) async {
    final controller = TextEditingController(text: remainingKes.toStringAsFixed(0));
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('How much are you paying?', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount (KES)'),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              icon: const Icon(Icons.phone_android),
              label: const Text('Pay with Fungu Pay (M-Pesa)'),
              onPressed: () {
                Navigator.of(ctx).pop();
                final amt = double.tryParse(controller.text.trim());
                if (amt != null && amt > 0) _pay(amt, 'stk_push');
              },
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              child: const Text('Mark as paid another way'),
              onPressed: () {
                Navigator.of(ctx).pop();
                final amt = double.tryParse(controller.text.trim());
                if (amt != null && amt > 0) _pay(amt, 'manual');
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Debt')),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Center(child: Text(_error!));
    }
    if (_data == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final debtJson = _data!['debt'] as Map<String, dynamic>;
    final debt = Debt.fromJson({...debtJson});
    final displayStatus = debtJson['displayStatus'] as String;
    final remainingKes = (debtJson['remainingCents'] as int) / 100;
    // Told directly by the server (see debts/[id]/route.ts) rather than
    // inferred client-side — the server already knows definitively whether
    // this viewer is the lender, borrower, or guarantor; re-deriving that
    // from IDs the client doesn't even have a "who am I" for would be
    // guessing at something already known authoritatively.
    // Defaulting a missing/unrecognized role to 'lender' — the MOST
    // permissive option, showing the most actions — was a real bug caught
    // live: a real tester's request appears to have landed during a
    // deploy-propagation window before the server started returning
    // viewerRole at all, and the 'lender' default incorrectly showed the
    // borrower an "Invite a guarantor" button (server correctly rejected
    // it with 403, but it shouldn't have been offered at all). Fail
    // closed instead — an empty string matches none of the role checks
    // below, so no role-gated action shows until we're actually sure.
    final viewerRole = debtJson['viewerRole'] as String? ?? '';
    final repayments = (_data!['repayments'] as List)
        .map((r) => Repayment.fromJson(r as Map<String, dynamic>))
        .toList();
    final guarantor = _data!['guarantor'] as Map<String, dynamic>?;
    final formatter = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ', decimalDigits: 0);
    final settled = debt.status == 'paid' || debt.status == 'cancelled';

    // Previously missing entirely: a guarantor had no way in the app to
    // actually accept or decline, even though the backend supported it —
    // the only way to test it was calling the API directly.
    final viewerIsPendingGuarantor = viewerRole == 'guarantor' && guarantor?['status'] == 'invited';

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(_roleLine(viewerRole, debt), style: const TextStyle(color: FunguColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 4),
          Text(debt.purpose, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(formatter.format(debt.amountKes), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('${formatter.format(remainingKes)} remaining', style: const TextStyle(color: FunguColors.textSecondary)),
          const SizedBox(height: 4),
          Text('Due ${DateFormat.yMMMd().format(debt.dueDate)} — ${displayStatusLabel(displayStatus)}',
              style: const TextStyle(color: FunguColors.textSecondary)),
          if (guarantor != null) ...[
            const SizedBox(height: 16),
            Card(
              elevation: 0,
              color: FunguColors.surface,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: ListTile(
                leading: const Icon(Icons.shield_outlined),
                title: Text('Guarantor: ${guarantor['guarantorPhone']}'),
                subtitle: Text(_guarantorStatusLabel(guarantor['status'] as String)),
              ),
            ),
          ],
          if (viewerIsPendingGuarantor) ...[
            const SizedBox(height: 16),
            const Text(
              "You've been asked to guarantee this debt — if the borrower doesn't pay, you may be asked to step in.",
              style: TextStyle(color: FunguColors.textSecondary),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: _guarantorActionLoading ? null : () => _respondToGuarantor(true),
                    child: const Text('Accept'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: _guarantorActionLoading ? null : () => _respondToGuarantor(false),
                    child: const Text('Decline'),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 24),
          // Only the borrower can pay — this used to show for anyone
          // viewing the debt, including the lender looking at their own
          // loan, and only failed silently server-side (403) if tapped.
          if (!settled && viewerRole == 'borrower')
            ElevatedButton(
              onPressed: _payLoading ? null : () => _showPaySheet(remainingKes),
              child: const Text('Make a payment'),
            ),
          // Only the lender can invite one, and only if nobody's been
          // invited yet — previously the only way to add a guarantor was
          // during creation, with no way to add one afterward.
          if (viewerRole == 'lender' && guarantor == null) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.shield_outlined),
              label: const Text('Invite a guarantor'),
              onPressed: _showInviteGuarantorSheet,
            ),
          ],
          const SizedBox(height: 24),
          if (repayments.isNotEmpty) ...[
            const Text('History', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            ...repayments.map((r) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    r.status == 'completed'
                        ? Icons.check_circle
                        : r.status == 'failed'
                            ? Icons.error_outline
                            : Icons.schedule,
                    color: r.status == 'completed' ? FunguColors.success : FunguColors.textSecondary,
                  ),
                  title: Text(formatter.format(r.amountKes)),
                  subtitle: Text('${r.method == 'stk_push' ? 'Fungu Pay (M-Pesa)' : 'Manual'} · ${r.status}'),
                  trailing: Text(DateFormat.MMMd().format(r.createdAt)),
                )),
          ],
        ],
      ),
    );
  }

  String _guarantorStatusLabel(String status) => switch (status) {
        'invited' => 'Invited — waiting for a response',
        'accepted' => 'Accepted',
        'declined' => 'Declined',
        _ => status,
      };

  String _roleLine(String viewerRole, Debt debt) => switch (viewerRole) {
        'lender' => '${debt.borrowerName ?? 'They'} owe${debt.borrowerName == 'You' ? '' : 's'} you',
        'borrower' => 'You owe ${debt.lenderName ?? 'them'}',
        'guarantor' => 'You\'re guaranteeing ${debt.lenderName ?? '?'} → ${debt.borrowerName ?? '?'}',
        _ => '',
      };
}

String displayStatusLabel(String status) => switch (status) {
      'pending' => 'not yet due',
      'partial' => 'partly paid',
      'paid' => 'settled',
      'overdue' => 'past the due date',
      'cancelled' => 'cancelled',
      _ => status,
    };
