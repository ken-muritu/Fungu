import { db } from "@/db/client";
import { debts, repayments, guarantorInvites, users } from "@/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { displayStatus } from "@/lib/status";
import { eq } from "drizzle-orm";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const debt = await db.query.debts.findFirst({ where: eq(debts.id, id) });
  if (!debt) return Response.json({ error: "Not found" }, { status: 404 });

  const guarantor = await db.query.guarantorInvites.findFirst({ where: eq(guarantorInvites.debtId, id) });

  // Was lender/borrower only — a guarantor could see this debt in their
  // ledger (fixed separately in debts/route.ts GET) but tapping into it
  // 404'd every time, a broken flow a real tester would hit immediately.
  // Same phone-or-userId matching as the PATCH /guarantor fix, for the
  // same reason: guarantorUserId isn't reliably set until they've
  // responded once.
  let isGuarantor = guarantor?.guarantorUserId === userId;
  if (!isGuarantor && guarantor) {
    const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
    isGuarantor = !!me && guarantor.guarantorPhone === me.phone;
  }

  if (debt.lenderId !== userId && debt.borrowerId !== userId && !isGuarantor) {
    return Response.json({ error: "Not found" }, { status: 404 }); // don't leak existence to non-parties
  }

  const repaymentRows = await db.query.repayments.findMany({
    where: eq(repayments.debtId, id),
    orderBy: (r, { asc }) => [asc(r.createdAt)],
  });

  const paidCents = repaymentRows
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.amountCents, 0);

  // Same enrichment as the list endpoint (debts/route.ts GET) — the client
  // screen references lenderName/borrowerName, so it needs to be here too,
  // not just in the list, or the detail screen would silently fall back to
  // "them"/"they" instead of the actual name.
  const [lender, borrower] = await Promise.all([
    debt.lenderId === userId ? null : db.query.users.findFirst({ where: eq(users.id, debt.lenderId) }),
    debt.borrowerId === userId ? null : db.query.users.findFirst({ where: eq(users.id, debt.borrowerId) }),
  ]);

  return Response.json({
    debt: {
      ...debt,
      displayStatus: displayStatus(debt.status, debt.dueDate),
      // Clamped defensively — the repayments route now rejects an
      // overpaying request, but this stays non-negative regardless (e.g.
      // pre-existing data, or a future code path that adds a repayment
      // without going through that check).
      remainingCents: Math.max(0, debt.amountCents - paidCents),
      lenderName: debt.lenderId === userId ? "You" : lender?.name ?? null,
      borrowerName: debt.borrowerId === userId ? "You" : borrower?.name ?? null,
    },
    repayments: repaymentRows,
    guarantor: guarantor ?? null,
    // Tells the client which role the viewer has for THIS debt, so the UI
    // can show the right actions (only the borrower can pay, only the
    // lender can invite a guarantor, only the invited guarantor can
    // respond) instead of showing every action to everyone and relying on
    // the server to reject the wrong ones after the fact.
    viewerRole: debt.lenderId === userId ? "lender" : debt.borrowerId === userId ? "borrower" : "guarantor",
  });
}
