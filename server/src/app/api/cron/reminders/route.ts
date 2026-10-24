import { after } from "next/server";
import { db } from "@/db/client";
import { debts, users } from "@/db/schema";
import { logEvent } from "@/lib/log";
import { sendSms } from "@/lib/sms";
import { and, or, eq, lt, isNull, inArray } from "drizzle-orm";

// Meant to be hit once a day by a Vercel Cron job (see vercel.json).
// Per MVP-PRD.md §4/§5: exactly ONE soft reminder per debt, ever — no
// repeated nagging, no escalating tone. That's why this only looks at rows
// where reminderSentAt IS NULL; once set, a debt is never touched again by
// this job even if it stays overdue for months.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  // Without a configured secret, "Bearer undefined" would match: refuse instead.
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const overdueUnreminded = await db.query.debts.findMany({
    where: and(
      or(eq(debts.status, "pending"), eq(debts.status, "partial")),
      lt(debts.dueDate, now),
      isNull(debts.reminderSentAt)
    ),
  });

  // Was one findFirst per debt inside the loop below (N+1) — batched into
  // a single query. Only matters at real scale, but a cron job is exactly
  // the kind of thing that silently gets slower and slower as data grows
  // if this isn't fixed early.
  const borrowerIds = [...new Set(overdueUnreminded.map((d) => d.borrowerId))];
  const borrowers =
    borrowerIds.length > 0 ? await db.query.users.findMany({ where: inArray(users.id, borrowerIds) }) : [];
  const borrowerById = new Map(borrowers.map((u) => [u.id, u]));

  let sent = 0;
  for (const debt of overdueUnreminded) {
    const borrower = borrowerById.get(debt.borrowerId);
    if (!borrower) continue;

    const dueDateStr = debt.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const amountKes = (debt.amountCents / 100).toLocaleString("en-KE");
    const message = `Fungu: your debt of KES ${amountKes} for "${debt.purpose}" was due ${dueDateStr}. Please settle it when you can.`;

    // reminderSentAt is only ever set on a CONFIRMED send. This is the one
    // soft reminder a debt ever gets (see comment above) — marking it sent
    // on a failed SMS would silently and permanently lose that reminder,
    // since nothing else ever re-checks a debt once this column is set.
    // A failure here just leaves the debt eligible again on tomorrow's run.
    try {
      await sendSms({ to: borrower.phone, message });
    } catch (err) {
      after(() =>
        logEvent({
          userId: debt.borrowerId,
          source: "server",
          eventType: "server_event",
          eventName: "reminder_sms_failed",
          detail: { debtId: debt.id, error: err instanceof Error ? err.message : String(err) },
        })
      );
      continue;
    }

    after(() =>
      logEvent({
        userId: debt.borrowerId,
        source: "server",
        eventType: "server_event",
        eventName: "reminder_marked_sent",
        detail: { debtId: debt.id },
      })
    );

    await db.update(debts).set({ reminderSentAt: now }).where(eq(debts.id, debt.id));
    sent++;
  }

  after(() =>
    logEvent({
      source: "server",
      eventType: "server_event",
      eventName: "reminder_cron_run",
      detail: { checked: overdueUnreminded.length, sent },
    })
  );

  return Response.json({ checked: overdueUnreminded.length, sent });
}
