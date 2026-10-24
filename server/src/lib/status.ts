export type DebtStatus = "pending" | "partial" | "paid" | "cancelled";
export type DisplayStatus = DebtStatus | "overdue";

/** "Overdue" is derived (dueDate passed + not yet paid), never stored — so
 *  it can never drift out of sync with the actual due date.
 *
 *  Known minor gap: dueDate is stored as UTC midnight of the picked
 *  calendar day (see app's api_client.dart for why — a naive local-to-UTC
 *  conversion shifts the day for non-UTC users). For Kenya (EAT, UTC+3),
 *  that means a debt technically flips to "overdue" at 3am local on the
 *  due day, not at the end of it. Low-severity boundary case — the due
 *  date always displays as the correct calendar day, this only affects a
 *  ~3-hour early window on the due date itself. Worth a proper fix (treat
 *  dueDate as end-of-day in a fixed EAT offset) if it turns out to matter
 *  in practice, not done here to avoid untested timezone-math complexity. */
export function displayStatus(status: DebtStatus, dueDate: Date, now = new Date()): DisplayStatus {
  if ((status === "pending" || status === "partial") && dueDate.getTime() < now.getTime()) {
    return "overdue";
  }
  return status;
}

// Copy is deliberately plain and non-shaming — see BRAINSTORM.md / MVP-PRD.md
// §2. No red "OVERDUE" styling implied by these strings; the client should
// keep tone consistent (warm blue/amber, not red-for-debt).
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: "Not yet due",
  partial: "Partly paid",
  paid: "Settled",
  overdue: "Past the due date",
  cancelled: "Cancelled",
};
