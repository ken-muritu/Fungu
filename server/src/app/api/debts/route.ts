import { after } from "next/server";
import { db } from "@/db/client";
import { debts, users, guarantorInvites } from "@/db/schema";
import { getUserIdFromRequest } from "@/lib/auth";
import { logEvent } from "@/lib/log";
import { nanoid } from "nanoid";
import { eq, or, inArray } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  borrowerPhone: z.string().regex(/^\+254\d{9}$/),
  amountKes: z.number().positive().max(10_000_000),
  purpose: z.string().min(1).max(280),
  dueDate: z.string().datetime(),
  // Pre-agreement checklist — both must be explicitly true to create a debt.
  // This is intentionally not skippable; see MVP-PRD.md §4.
  checklistCanAfford: z.literal(true),
  checklistKnowsConsequences: z.literal(true),
  // Optional for backward compat with any already-built client that
  // predates this field — but every client build from here on sends one.
  // See schema.ts's idempotencyKey comment for the real incident that
  // caused this: a slow request (14-15s, Vercel cold-start + Turso
  // latency), a client timeout, and a retry that created a genuine
  // duplicate debt in production.
  idempotencyKey: z.string().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  const lenderId = getUserIdFromRequest(req);
  if (!lenderId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = createSchema.safeParse(await req.json());
  if (!body.success) {
    return Response.json({ error: body.error.flatten() }, { status: 400 });
  }
  const data = body.data;

  // These two lookups are independent of each other — run concurrently
  // rather than sequentially. Real, measured motivation: this endpoint was
  // taking 14-15s in production (found via the logs themselves), timing
  // out the client and causing a genuine duplicate debt (see
  // idempotencyKey handling below). Every avoidable sequential round trip
  // to a remote database matters when each one is apparently costing
  // multiple seconds.
  const [existingByKey, borrower] = await Promise.all([
    data.idempotencyKey
      ? db.query.debts.findFirst({ where: eq(debts.idempotencyKey, data.idempotencyKey) })
      : Promise.resolve(undefined),
    db.query.users.findFirst({ where: eq(users.phone, data.borrowerPhone) }),
  ]);

  if (existingByKey) {
    // Same logical request seen again (the original almost certainly DID
    // succeed server-side; the client just never saw the response in
    // time) — hand back the debt that already exists instead of creating
    // a second one. Not logged as a fresh debt_created, since nothing new
    // actually happened.
    return Response.json({ id: existingByKey.id }, { status: 201 });
  }

  if (!borrower) {
    // v1: borrower must already have a Fungu account. Inviting a non-user
    // by SMS is a real feature but out of scope for this cut — see
    // MVP-PRD.md's out-of-scope table (closest analog: statement import).
    return Response.json(
      { error: "No Fungu account found for that phone number yet" },
      { status: 404 }
    );
  }
  if (borrower.id === lenderId) {
    return Response.json({ error: "You can't create a debt with yourself" }, { status: 400 });
  }

  const id = nanoid();
  try {
    await db.insert(debts).values({
      id,
      lenderId,
      borrowerId: borrower.id,
      amountCents: Math.round(data.amountKes * 100),
      purpose: data.purpose,
      dueDate: new Date(data.dueDate),
      status: "pending",
      checklistCanAfford: data.checklistCanAfford,
      checklistKnowsConsequences: data.checklistKnowsConsequences,
      idempotencyKey: data.idempotencyKey ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    // The check-then-insert above isn't a transaction, so two genuinely
    // concurrent retries with the same idempotencyKey could both pass the
    // "not found" check before either inserts — the unique index then
    // rejects the second insert. Re-fetch and hand back the winner instead
    // of surfacing a raw 500 for what's actually a successful outcome.
    if (data.idempotencyKey) {
      const existing = await db.query.debts.findFirst({ where: eq(debts.idempotencyKey, data.idempotencyKey) });
      if (existing) return Response.json({ id: existing.id }, { status: 201 });
    }
    throw e;
  }

  // Logging moved off the response's critical path via after() — see
  // register/route.ts's comment for why this matters specifically here.
  after(() =>
    logEvent({
      userId: lenderId,
      source: "server",
      eventType: "server_event",
      eventName: "debt_created",
      detail: { debtId: id, borrowerId: borrower.id, amountKes: data.amountKes },
    })
  );

  return Response.json({ id }, { status: 201 });
}

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Guarantor visibility — originally missing entirely: this only checked
  // lender/borrower, so a debt's guarantor could never see it in their own
  // ledger even after accepting. Matches by phone as well as the stored
  // guarantorUserId, since an invite sent before the guarantor had a Fungu
  // account never gets that column backfilled just by existing — see the
  // matching fix in guarantor/route.ts PATCH for the same root cause.
  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const guarantorFor = me
    ? await db.query.guarantorInvites.findMany({
        where: or(eq(guarantorInvites.guarantorUserId, userId), eq(guarantorInvites.guarantorPhone, me.phone)),
      })
    : [];
  const guaranteedDebtIds = guarantorFor.map((g) => g.debtId);

  // Built as an explicit array rather than passing a possibly-undefined
  // third argument straight into or() — not confident this drizzle-orm
  // version treats undefined as "ignore this condition" rather than
  // erroring or matching nothing, and getting that wrong would break the
  // entire ledger listing, not just guarantor visibility.
  const conditions = [eq(debts.lenderId, userId), eq(debts.borrowerId, userId)];
  if (guaranteedDebtIds.length > 0) conditions.push(inArray(debts.id, guaranteedDebtIds));

  const rows = await db.query.debts.findMany({
    where: or(...conditions),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  });

  // Enriched with viewerRole + counterparty name/phone — the list response
  // previously only had raw lenderId/borrowerId, giving the client no way
  // to show WHO the other party actually is, or even whether a given debt
  // means "you're owed" or "you owe" without a second round-trip to the
  // detail endpoint for every card. A flat list of amounts and dates with
  // no indication of direction or counterparty isn't a usable ledger.
  const counterpartyIds = new Set<string>();
  for (const d of rows) {
    if (d.lenderId !== userId) counterpartyIds.add(d.lenderId);
    if (d.borrowerId !== userId) counterpartyIds.add(d.borrowerId);
  }
  const counterparties =
    counterpartyIds.size > 0
      ? await db.query.users.findMany({ where: inArray(users.id, [...counterpartyIds]) })
      : [];
  const counterpartyById = new Map(counterparties.map((u) => [u.id, u]));

  const enriched = rows.map((d) => {
    const viewerRole = d.lenderId === userId ? "lender" : d.borrowerId === userId ? "borrower" : "guarantor";
    const lender = d.lenderId === userId ? null : counterpartyById.get(d.lenderId);
    const borrower = d.borrowerId === userId ? null : counterpartyById.get(d.borrowerId);
    return {
      ...d,
      viewerRole,
      lenderName: d.lenderId === userId ? "You" : lender?.name ?? null,
      borrowerName: d.borrowerId === userId ? "You" : borrower?.name ?? null,
    };
  });

  return Response.json({ debts: enriched });
}
