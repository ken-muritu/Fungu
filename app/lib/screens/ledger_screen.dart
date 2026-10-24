import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/debt.dart';
import '../services/api_client.dart';
import '../services/event_logger.dart';
import '../theme.dart';
import 'create_debt_screen.dart';
import 'debt_detail_screen.dart';
import 'auth/login_screen.dart';

class LedgerScreen extends StatefulWidget {
  const LedgerScreen({super.key});

  @override
  State<LedgerScreen> createState() => _LedgerScreenState();
}

class _LedgerScreenState extends State<LedgerScreen> {
  List<Debt>? _debts;
  String? _error;

  @override
  void initState() {
    super.initState();
    EventLogger.instance.screenView('LedgerScreen');
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final debts = await ApiClient.instance.listDebts();
      setState(() => _debts = debts);
    } on ApiException catch (e) {
      // A 401 here is handled centrally now — ApiClient redirects to login
      // itself on any authenticated call's 401, from any screen, not just
      // this one. See ApiClient._decode.
      if (e.statusCode == 401) return;
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fungu'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              EventLogger.instance.userAction('tap_logout');
              await ApiClient.instance.logout();
              if (!mounted) return;
              Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          EventLogger.instance.userAction('tap_new_debt');
          final created = await Navigator.of(context).push<bool>(
            MaterialPageRoute(builder: (_) => const CreateDebtScreen()),
          );
          if (created == true) _load();
        },
        icon: const Icon(Icons.add),
        label: const Text('New debt'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return _CenteredMessage(text: _error!, action: TextButton(onPressed: _load, child: const Text('Retry')));
    }
    if (_debts == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_debts!.isEmpty) {
      return const _CenteredMessage(
        text: 'No debts tracked yet.\nTap "New debt" to record one — before it becomes an awkward conversation.',
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _debts!.length,
      itemBuilder: (context, i) => _DebtCard(
        debt: _debts![i],
        onTap: () async {
          await Navigator.of(context)
              .push(MaterialPageRoute(builder: (_) => DebtDetailScreen(debtId: _debts![i].id)));
          _load();
        },
      ),
    );
  }
}

class _DebtCard extends StatelessWidget {
  final Debt debt;
  final VoidCallback onTap;

  const _DebtCard({required this.debt, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final formatter = NumberFormat.currency(locale: 'en_KE', symbol: 'KES ', decimalDigits: 0);
    final dueFormatted = DateFormat.yMMMd().format(debt.dueDate);
    final isOverdue = debt.dueDate.isBefore(DateTime.now()) && debt.status != 'paid' && debt.status != 'cancelled';

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      color: FunguColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(child: Text(debt.purpose, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16))),
                  Text(formatter.format(debt.amountKes), style: const TextStyle(fontWeight: FontWeight.w600)),
                ],
              ),
              const SizedBox(height: 2),
              Text(_directionLabel(debt), style: const TextStyle(color: FunguColors.textSecondary, fontSize: 13)),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Due $dueFormatted', style: const TextStyle(color: FunguColors.textSecondary, fontSize: 13)),
                  _StatusPill(status: debt.status, overdue: isOverdue),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "You're owed" vs "You owe" vs guaranteeing someone else's debt — without
/// this every card just showed an amount and a date with no indication of
/// direction, which isn't a usable ledger.
String _directionLabel(Debt debt) {
  switch (debt.viewerRole) {
    case 'lender':
      return "${debt.borrowerName ?? 'Someone'} owes you";
    case 'borrower':
      return "You owe ${debt.lenderName ?? 'someone'}";
    case 'guarantor':
      return "Guaranteeing: ${debt.lenderName ?? '?'} → ${debt.borrowerName ?? '?'}";
    default:
      return '';
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  final bool overdue;
  const _StatusPill({required this.status, required this.overdue});

  @override
  Widget build(BuildContext context) {
    final label = overdue
        ? 'Past due date'
        : switch (status) {
            'pending' => 'Not yet due',
            'partial' => 'Partly paid',
            'paid' => 'Settled',
            'cancelled' => 'Cancelled',
            _ => status,
          };
    final color = status == 'paid'
        ? FunguColors.success
        : overdue
            ? FunguColors.softAmber
            : FunguColors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withOpacity(0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  final String text;
  final Widget? action;
  const _CenteredMessage({required this.text, this.action});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(text, textAlign: TextAlign.center, style: const TextStyle(color: FunguColors.textSecondary)),
            if (action != null) ...[const SizedBox(height: 8), action!],
          ],
        ),
      ),
    );
  }
}
