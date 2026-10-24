import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Phone-number-first accounts. No email requirement — matches how M-Pesa
// itself identifies people, and keeps signup to a single field.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(), // E.164, e.g. +254712345678
  name: text("name").notNull(),
  pinHash: text("pin_hash").notNull(), // 4-6 digit PIN, hashed — not a password. Matches M-Pesa's own mental model.
  // A 4-digit PIN is only 10,000 combinations, and Vercel serverless
  // functions are stateless — nothing in-memory can rate-limit login
  // attempts across invocations. This pair implements a DB-backed lockout
  // instead: failedLoginAttempts increments on each wrong PIN, resets on
  // success, and once it crosses the threshold (see login/route.ts)
  // lockedUntil is set and further attempts are rejected until it passes.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Debt status lifecycle: pending -> partial -> paid, or pending/partial -> overdue
// (overdue is a derived display state computed from dueDate + status, not a
// separate stored value the app has to keep in sync — see lib/status.ts).
export const debts = sqliteTable("debts", {
  id: text("id").primaryKey(),
  lenderId: text("lender_id").notNull().references(() => users.id),
  borrowerId: text("borrower_id").notNull().references(() => users.id),
  amountCents: integer("amount_cents").notNull(), // KES, stored as cents to avoid float rounding
  purpose: text("purpose").notNull(),
  dueDate: integer("due_date", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["pending", "partial", "paid", "cancelled"] })
    .notNull()
    .default("pending"),
  // Pre-agreement checklist — captured at creation, never edited after.
  // This is the moment most likely to change behavior (per BRAINSTORM.md's
  // Co-op Bank Foundation session finding), so it's a hard field on the
  // debt itself, not an optional afterthought.
  checklistCanAfford: integer("checklist_can_afford", { mode: "boolean" }).notNull(),
  checklistKnowsConsequences: integer("checklist_knows_consequences", { mode: "boolean" }).notNull(),
  reminderSentAt: integer("reminder_sent_at", { mode: "timestamp" }), // null until the single soft reminder fires
  // Caught live via event_logs: a real debt-creation request took 14-15s
  // (Vercel cold-start + Turso connection latency compounding), the
  // client's 15s timeout gave up before the response arrived, and a retry
  // created a genuine duplicate — same lender/borrower/amount/purpose,
  // same second. Client generates this once per create-debt attempt and
  // resends it on retry; the insert becomes a no-op (existing row
  // returned) if it's ever seen twice.
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Guarantor is optional and invited by phone number — they may not have an
// account yet. Kept as its own table (not a column on debts) because it has
// an independent accept/decline lifecycle.
export const guarantorInvites = sqliteTable("guarantor_invites", {
  id: text("id").primaryKey(),
  debtId: text("debt_id").notNull().references(() => debts.id),
  guarantorPhone: text("guarantor_phone").notNull(),
  guarantorUserId: text("guarantor_user_id").references(() => users.id), // set once/if they have or create an account
  status: text("status", { enum: ["invited", "accepted", "declined"] })
    .notNull()
    .default("invited"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  respondedAt: integer("responded_at", { mode: "timestamp" }),
});

// One row per payment towards a debt — supports partial/installment repayment
// (PRD explicitly calls out that real repayment rarely happens in one shot).
export const repayments = sqliteTable("repayments", {
  id: text("id").primaryKey(),
  debtId: text("debt_id").notNull().references(() => debts.id),
  amountCents: integer("amount_cents").notNull(),
  method: text("method", { enum: ["stk_push", "manual"] }).notNull(),
  // Manual = borrower/lender marks it settled outside the app (cash, bank
  // transfer, etc.) — the ledger should reflect reality even when STK Push
  // isn't used, not force every repayment through M-Pesa.
  mpesaCheckoutRequestId: text("mpesa_checkout_request_id"), // Daraja's own tracking id, set once STK push is initiated
  mpesaReceiptNumber: text("mpesa_receipt_number"), // set once Daraja's callback confirms payment
  status: text("status", { enum: ["pending", "completed", "failed"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Every action worth tracing, from every source: client-reported (screen
// views, button taps, every network call the Flutter app makes, uncaught
// errors) AND server-observed (every route handler, the mpesa callback,
// the reminder cron). Nothing here is inferred after the fact — it's the
// actual record of what happened, in order, per user and per session, so a
// bug report or "this flow didn't work" can be traced to exactly what the
// app and server did. See lib/log.ts for the write path and the PIN/token
// scrubbing that keeps this table from ever holding a credential.
export const eventLogs = sqliteTable("event_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"), // nullable — not FK-enforced: pre-auth events (a failed login, a register attempt) have no user yet
  sessionId: text("session_id"), // client-generated per app launch, groups one usage session together
  source: text("source", { enum: ["client", "server"] }).notNull(),
  platform: text("platform"), // android | ios | web | server — null for pure server-side events
  appVersion: text("app_version"), // git commit SHA the client was built from, see build-apk.yml / build-web.yml
  eventType: text("event_type", {
    enum: ["app_lifecycle", "screen_view", "user_action", "api_call", "error", "server_event"],
  }).notNull(),
  eventName: text("event_name").notNull(), // e.g. 'LedgerScreen', 'tap_create_debt', 'POST /api/debts', 'ApiException'
  detail: text("detail"), // JSON blob, freeform — status codes, durations, error messages; never a pin/token, see log.ts
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
