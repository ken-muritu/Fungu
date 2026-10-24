-- Mirrors src/db/schema.ts exactly. Applied directly via `turso db shell`
-- rather than `drizzle-kit push`, to sidestep drizzle-kit's Turso config
-- friction encountered during initial deploy (see drizzle.config.ts and
-- git history) — this is the same schema, just applied a different way.
-- If the Drizzle schema changes, update both this file and re-apply.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);
-- Note: on the live DB these two columns were added via ALTER TABLE (this
-- file predates them) — CREATE TABLE IF NOT EXISTS won't retrofit an
-- already-existing table, so if you're setting up a fresh DB from this
-- file alone it's already correct, but re-running this file against an
-- older existing DB will NOT add them. Use the ALTER TABLE statements in
-- the login lockout commit for that case.

CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  lender_id TEXT NOT NULL REFERENCES users(id),
  borrower_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  due_date INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  checklist_can_afford INTEGER NOT NULL,
  checklist_knows_consequences INTEGER NOT NULL,
  reminder_sent_at INTEGER,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_debts_idempotency ON debts(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS guarantor_invites (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id),
  guarantor_phone TEXT NOT NULL,
  guarantor_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'invited',
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);

CREATE TABLE IF NOT EXISTS repayments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL,
  mpesa_checkout_request_id TEXT,
  mpesa_receipt_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  source TEXT NOT NULL,
  platform TEXT,
  app_version TEXT,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debts_lender ON debts(lender_id);
CREATE INDEX IF NOT EXISTS idx_debts_borrower ON debts(borrower_id);
CREATE INDEX IF NOT EXISTS idx_guarantor_invites_debt ON guarantor_invites(debt_id);
CREATE INDEX IF NOT EXISTS idx_repayments_debt ON repayments(debt_id);
CREATE INDEX IF NOT EXISTS idx_repayments_checkout ON repayments(mpesa_checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_user ON event_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_session ON event_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_created ON event_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_event_logs_type ON event_logs(event_type, event_name);
