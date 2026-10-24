import { after } from "next/server";
import { db } from "@/db/client";
import { repayments, debts, users } from "@/db/schema";
import { parseStkCallback, disburseToLender } from "@/lib/mpesa";
import { recalculateDebtStatus } from "@/lib/debt-status";
import { logEvent } from "@/lib/log";
import { eq } from "drizzle-orm";

// Safaricom calls this — no auth header from the borrower's session, this
// is server-to-server. Daraja does not sign callbacks in a way this app
// currently verifies; production hardening should restrict this route to
// Safaricom's published IP ranges. Flagged, not yet implemented — v1 gap.
export async function POST(req: Request) {
  const body = await req.json();
  let result;
  try {
    result = parseStkCallback(body);
  } catch (e) {
    console.error("Malformed Daraja callback", e);
    after(() =>
      logEvent({
        source: "server",
        eventType: "error",
        eventName: "mpesa_callback_malformed",
        detail: { message: e instanceof Error ? e.message : String(e) },
      })
    );
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" }); // ack anyway per Daraja's expected contract
  }

  const repayment = await db.query.repayments.findFirst({
    where: eq(repayments.mpesaCheckoutRequestId, result.checkoutRequestId),
  });
  if (!repayment) {
    console.error("Callback for unknown checkoutRequestId", result.checkoutRequestId);
    after(() =>
      logEvent({
        source: "server",
        eventType: "error",
        eventName: "mpesa_callback_unknown_checkout_id",
        detail: { checkoutRequestId: result.checkoutRequestId },
      })
    );
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  const debt = await db.query.debts.findFirst({ where: eq(debts.id, repayment.debtId) });

  if (!result.success) {
    await db.update(repayments).set({ status: "failed" }).where(eq(repayments.id, repayment.id));
    after(() =>
      logEvent({
        userId: debt?.borrowerId,
        source: "server",
        eventType: "server_event",
        eventName: "mpesa_payment_failed",
        detail: { debtId: repayment.debtId, resultDesc: result.resultDesc },
      })
    );
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  await db
    .update(repayments)
    .set({ status: "completed", mpesaReceiptNumber: result.mpesaReceiptNumber })
    .where(eq(repayments.id, repayment.id));
  // Passes the already-fetched debt to skip a redundant lookup inside —
  // see debt-status.ts's doc comment.
  await recalculateDebtStatus(repayment.debtId, debt);
  after(() =>
    logEvent({
      userId: debt?.borrowerId,
      source: "server",
      eventType: "server_event",
      eventName: "mpesa_payment_confirmed",
      detail: { debtId: repayment.debtId, mpesaReceiptNumber: result.mpesaReceiptNumber, amountKes: result.amountKes },
    })
  );

  // Forward to the lender. See lib/mpesa.ts header comment — this is the
  // step that actually completes peer-to-peer settlement, and the reason
  // funds transit a Fungu-controlled account rather than never touching it.
  if (debt) {
    const lender = await db.query.users.findFirst({ where: eq(users.id, debt.lenderId) });
    if (lender && result.amountKes) {
      try {
        await disburseToLender({
          phoneNumber: lender.phone.replace(/^\+/, ""),
          amountKes: result.amountKes,
          remarks: `Fungu debt repayment: ${debt.purpose}`.slice(0, 100),
          resultUrl: `${process.env.PUBLIC_BASE_URL}/api/mpesa/b2c-result`,
          queueTimeoutUrl: `${process.env.PUBLIC_BASE_URL}/api/mpesa/b2c-timeout`,
        });
        after(() =>
          logEvent({
            userId: debt.lenderId,
            source: "server",
            eventType: "server_event",
            eventName: "mpesa_b2c_disbursement_initiated",
            detail: { debtId: debt.id, amountKes: result.amountKes },
          })
        );
      } catch (e) {
        // The borrower's payment already succeeded and is recorded — a
        // failed forward-to-lender is an operational problem to alert on,
        // not something that should undo the repayment record.
        console.error("B2C disbursement to lender failed", e);
        after(() =>
          logEvent({
            userId: debt.lenderId,
            source: "server",
            eventType: "error",
            eventName: "mpesa_b2c_disbursement_failed",
            detail: { debtId: debt.id, message: e instanceof Error ? e.message : String(e) },
          })
        );
      }
    }
  }

  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
