import { db } from "@/db/client";
import { debts, repayments } from "@/db/schema";
import type { InferSelectModel } from "drizzle-orm";
import { eq } from "drizzle-orm";

type DebtRow = InferSelectModel<typeof debts>;

/** Debt status is a rollup of its completed repayments — recomputed after
 *  every repayment change rather than incrementally patched, so it can
 *  never drift out of sync.
 *
 *  Lives here rather than in a route.ts file: Next.js App Router route
 *  files may only export the specific HTTP-method handlers (GET, POST,
 *  etc.) plus a small set of special config exports — any other export
 *  (this was originally exported from repayments/route.ts) fails the
 *  production build's route-shape validation.
 *
 *  Accepts an already-fetched debt row when the caller has one (both
 *  current callers do) to skip a redundant lookup — every avoidable round
 *  trip matters, see debts/route.ts POST's comment for why this got
 *  audited in the first place. */
export async function recalculateDebtStatus(debtId: string, knownDebt?: DebtRow) {
  const debt = knownDebt ?? (await db.query.debts.findFirst({ where: eq(debts.id, debtId) }));
  if (!debt) return;
  const rows = await db.query.repayments.findMany({ where: eq(repayments.debtId, debtId) });
  const paidCents = rows.filter((r) => r.status === "completed").reduce((s, r) => s + r.amountCents, 0);

  const status = paidCents >= debt.amountCents ? "paid" : paidCents > 0 ? "partial" : "pending";
  if (status !== debt.status) {
    await db.update(debts).set({ status }).where(eq(debts.id, debtId));
  }
}
