import { after } from "next/server";
import { db } from "@/db/client";
import { debts, repayments, users } from "@/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { initiateStkPush } from "@/lib/mpesa";
import { recalculateDebtStatus } from "@/lib/debt-status";
import { logEvent } from "@/lib/log";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  amountKes: z.number().positive(),
  method: z.enum(["stk_push", "manual"]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const debt = await db.query.debts.findFirst({ where: eq(debts.id, id) });
  if (!debt) return Response.json({ error: "Not found" }, { status: 404 });
  if (debt.borrowerId !== userId) {
    return Response.json({ error: "Only the borrower can make a repayment" }, { status: 403 });
  }
  if (debt.status === "paid" || debt.status === "cancelled") {
    return Response.json({ error: "This debt is already settled" }, { status: 409 });
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.flatten() }, { status: 400 });
  const { amountKes, method } = body.data;

  // No cap existed here before — a repayment could exceed what's actually
  // owed, driving remainingCents negative (surfaced in the Flutter pay
  // sheet as a negative pre-filled amount). Counts pending STK pushes too,
  // not just completed ones: a double-tap on "Pay" (nothing in the client
  // debounces the pay-sheet buttons themselves) could otherwise fire two
  // requests for the full remaining balance before either resolves, both
  // passing a completed-only check and risking a real double-charge if the
  // borrower approves both phone prompts. This narrows that race but
  // doesn't eliminate it outright — there's still a small window between
  // this read and the insert below where two concurrent requests could
  // both pass; closing that fully needs a DB-level constraint or
  // transaction, not done here.
  const existing = await db.query.repayments.findMany({ where: eq(repayments.debtId, id) });
  const committedCents = existing
    .filter((r) => r.status === "completed" || r.status === "pending")
    .reduce((s, r) => s + r.amountCents, 0);
  const remainingCents = debt.amountCents - committedCents;
  const amountCents = Math.round(amountKes * 100);
  if (amountCents > remainingCents) {
    return Response.json(
      { error: `That's more than what's left on this debt (KES ${(remainingCents / 100).toFixed(0)} remaining)` },
      { status: 400 }
    );
  }

  const repaymentId = nanoid();

  if (method === "manual") {
    // Marked settled outside the app (cash, bank transfer, etc). Ledger
    // should reflect reality even when M-Pesa isn't the rail used — see
    // MVP-PRD.md §4, repayments schema comment.
    await db.insert(repayments).values({
      id: repaymentId,
      debtId: id,
      amountCents,
      method: "manual",
      status: "completed",
      createdAt: new Date(),
    });
    // Passes the already-fetched debt to skip a redundant lookup inside —
    // see debt-status.ts's doc comment.
    await recalculateDebtStatus(id, debt);
    after(() =>
      logEvent({
        userId,
        source: "server",
        eventType: "server_event",
        eventName: "repayment_manual",
        detail: { debtId: id, amountKes },
      })
    );
    return Response.json({ id: repaymentId, status: "completed" }, { status: 201 });
  }

  // stk_push: get the borrower's own phone to prompt for payment, kicking
  // off the C2B leg described in lib/mpesa.ts. Funds land in Fungu's
  // shortcode first; forwarding to the lender (B2C) happens once the
  // callback confirms payment — see /api/mpesa/callback.
  const borrower = await db.query.users.findFirst({ where: eq(users.id, debt.borrowerId) });
  if (!borrower) return Response.json({ error: "Borrower account not found" }, { status: 500 });

  const callbackUrl = `${process.env.PUBLIC_BASE_URL}/api/mpesa/callback`;
  let stk;
  try {
    stk = await initiateStkPush({
      phoneNumber: borrower.phone.replace(/^\+/, ""),
      amountKes,
      accountReference: id,
      transactionDesc: `Fungu: ${debt.purpose}`.slice(0, 100),
      callbackUrl,
    });
  } catch (e) {
    // Most likely cause right now: no real Daraja credentials configured
    // yet (see MVP-PRD.md §9) — logged distinctly from a genuine runtime
    // failure so this expected-for-now gap doesn't get chased as a mystery
    // bug later.
    after(() =>
      logEvent({
        userId,
        source: "server",
        eventType: "error",
        eventName: "stk_push_initiate_failed",
        detail: { debtId: id, message: e instanceof Error ? e.message : String(e) },
      })
    );
    return Response.json({ error: "Couldn't start the M-Pesa payment — try again shortly" }, { status: 502 });
  }

  await db.insert(repayments).values({
    id: repaymentId,
    debtId: id,
    amountCents,
    method: "stk_push",
    mpesaCheckoutRequestId: stk.checkoutRequestId,
    status: "pending",
    createdAt: new Date(),
  });

  after(() =>
    logEvent({
      userId,
      source: "server",
      eventType: "server_event",
      eventName: "repayment_stk_push_initiated",
      detail: { debtId: id, amountKes, checkoutRequestId: stk.checkoutRequestId },
    })
  );

  return Response.json(
    { id: repaymentId, status: "pending", customerMessage: stk.customerMessage },
    { status: 201 }
  );
}
