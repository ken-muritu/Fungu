class Debt {
  final String id;
  final String lenderId;
  final String borrowerId;
  final int amountCents;
  final String purpose;
  final DateTime dueDate;
  final String status; // pending | partial | paid | cancelled
  final String? displayStatus; // includes derived "overdue" — present on detail fetch
  final int? remainingCents;
  final DateTime createdAt;
  // Added when the server started enriching the response — without these
  // the client had no way to show WHO the other party is, or whether a
  // debt means "you're owed" or "you owe", without a second round-trip.
  final String? viewerRole; // lender | borrower | guarantor, relative to whoever's logged in
  final String? lenderName; // "You" when the viewer is the lender
  final String? borrowerName; // "You" when the viewer is the borrower

  Debt({
    required this.id,
    required this.lenderId,
    required this.borrowerId,
    required this.amountCents,
    required this.purpose,
    required this.dueDate,
    required this.status,
    this.displayStatus,
    this.remainingCents,
    required this.createdAt,
    this.viewerRole,
    this.lenderName,
    this.borrowerName,
  });

  double get amountKes => amountCents / 100;
  double get remainingKes => (remainingCents ?? amountCents) / 100;

  factory Debt.fromJson(Map<String, dynamic> json) {
    return Debt(
      id: json['id'],
      lenderId: json['lenderId'],
      borrowerId: json['borrowerId'],
      amountCents: json['amountCents'],
      purpose: json['purpose'],
      dueDate: DateTime.parse(json['dueDate']),
      status: json['status'],
      displayStatus: json['displayStatus'],
      remainingCents: json['remainingCents'],
      createdAt: DateTime.parse(json['createdAt']),
      viewerRole: json['viewerRole'],
      lenderName: json['lenderName'],
      borrowerName: json['borrowerName'],
    );
  }
}

class Repayment {
  final String id;
  final String debtId;
  final int amountCents;
  final String method; // stk_push | manual
  final String status; // pending | completed | failed
  final DateTime createdAt;

  Repayment({
    required this.id,
    required this.debtId,
    required this.amountCents,
    required this.method,
    required this.status,
    required this.createdAt,
  });

  double get amountKes => amountCents / 100;

  factory Repayment.fromJson(Map<String, dynamic> json) {
    return Repayment(
      id: json['id'],
      debtId: json['debtId'],
      amountCents: json['amountCents'],
      method: json['method'],
      status: json['status'],
      createdAt: DateTime.parse(json['createdAt']),
    );
  }
}
