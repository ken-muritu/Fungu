import { after } from "next/server";
import { db } from "@/db/client";
import { debts, guarantorInvites, users } from "@/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { sendSms } from "@/lib/sms";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { z } from "zod";

// Inviting a guarantor is optional and lender-initiated, per MVP-PRD.md §4:
// required-on-every-debt would add friction that risks killing the core
// loop before it's proven.
const inviteSchema = z.object({
  guarantorPhone: z.string().regex(/^\+254\d{9}$/),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const debt = await db.query.debts.findFirst({ where: eq(debts.id, id) });
  if (!debt) return Response.json({ error: "Not found" }, { status: 404 });
  if (debt.lenderId !== userId) {
    return Response.json({ error: "Only the lender can invite a guarantor" }, { status: 403 });
  }

  const body = inviteSchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.flatten() }, { status: 400 });

  // Independent lookups run concurrently rather than sequentially — see
  // debts/route.ts POST's comment for the measured latency reason this
  // matters everywhere, not just there.
  const [existing, lender, borrower, guarantorUser] = await Promise.all([
    db.query.guarantorInvites.findFirst({ where: eq(guarantorInvites.debtId, id) }),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.users.findFirst({ where: eq(users.id, debt.borrowerId) }),
    db.query.users.findFirst({ where: eq(users.phone, body.data.guarantorPhone) }),
  ]);

  if (existing) {
    return Response.json({ error: "A guarantor has already been invited for this debt" }, { status: 409 });
  }

  // A guarantor is meant to be a third party vouching for the borrower —
  // the lender guaranteeing their own loan, or the borrower guaranteeing
  // themselves, defeats the entire point and wasn't blocked before.
  if (body.data.guarantorPhone === lender?.phone || body.data.guarantorPhone === borrower?.phone) {
    return Response.json({ error: "The guarantor needs to be someone other than the lender or borrower" }, { status: 400 });
  }

  const inviteId = nanoid();
  await db.insert(guarantorInvites).values({
    id: inviteId,
    debtId: id,
    guarantorPhone: body.data.guarantorPhone,
    guarantorUserId: guarantorUser?.id ?? null,
    status: "invited",
    createdAt: new Date(),
  });

  // Best-effort: the invite already exists and is visible in-app to a
  // guarantor who has (or later creates) a Fungu account under this phone
  // number, so an SMS-provider outage here shouldn't fail the whole
  // request — it would just mean the guarantor finds out from the app
  // instead of a text.
  const amountKes = (debt.amountCents / 100).toLocaleString("en-KE");
  const message = `Fungu: ${lender?.name ?? "Someone"} asked you to guarantee a debt of KES ${amountKes} for "${debt.purpose}". Open the Fungu app to accept or decline.`;
  try {
    await sendSms({ to: body.data.guarantorPhone, message });
  } catch (err) {
    after(() =>
      logEvent({
        userId,
        source: "server",
        eventType: "server_event",
        eventName: "guarantor_invite_sms_failed",
        detail: { debtId: id, error: err instanceof Error ? err.message : String(err) },
      })
    );
  }

  after(() =>
    logEvent({
      userId,
      source: "server",
      eventType: "server_event",
      eventName: "guarantor_invited",
      detail: { debtId: id, guarantorHadAccount: !!guarantorUser },
    })
  );

  return Response.json({ id: inviteId }, { status: 201 });
}

const respondSchema = z.object({
  response: z.enum(["accepted", "declined"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [invite, me] = await Promise.all([
    db.query.guarantorInvites.findFirst({ where: eq(guarantorInvites.debtId, id) }),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
  ]);
  if (!invite) return Response.json({ error: "Not found" }, { status: 404 });

  // Was previously guarded by guarantorUserId alone — which is only ever
  // set at invite time if the guarantor already had a Fungu account. For
  // anyone invited before signing up (the normal case for a brand-new
  // app), that column stays null forever and this check failed for every
  // single one of them, permanently. Phone number is the durable identity
  // here; guarantorUserId is just a cache of it, backfilled below once we
  // can actually resolve it.
  const isInvitedGuarantor = invite.guarantorUserId === userId || (me && invite.guarantorPhone === me.phone);
  if (!isInvitedGuarantor) {
    return Response.json({ error: "Only the invited guarantor can respond" }, { status: 403 });
  }
  if (invite.status !== "invited") {
    return Response.json({ error: "This invite has already been responded to" }, { status: 409 });
  }

  const body = respondSchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.flatten() }, { status: 400 });

  await db
    .update(guarantorInvites)
    .set({ status: body.data.response, respondedAt: new Date(), guarantorUserId: userId })
    .where(eq(guarantorInvites.id, invite.id));

  after(() =>
    logEvent({
      userId,
      source: "server",
      eventType: "server_event",
      eventName: `guarantor_${body.data.response}`,
      detail: { debtId: id },
    })
  );

  return Response.json({ status: body.data.response });
}
