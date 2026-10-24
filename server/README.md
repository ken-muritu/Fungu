# Fungu — server

Next.js API-only backend for the Fungu Flutter app (`../app`). Next.js +
Turso (libSQL, via Drizzle) on Vercel, per `MVP-PRD.md` §7.

## Setup

```
npm install
npm run db:push              # push the Drizzle schema to your Turso DB
npm run dev
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | Turso (libSQL) database |
| `JWT_SECRET` | Signs session tokens |
| `PUBLIC_BASE_URL` | Base URL used to build M-Pesa callback URLs |
| `CRON_SECRET` | Protects `/api/cron/reminders` |
| `MPESA_ENV` | `sandbox` or `production` |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY` | Daraja STK Push |
| `MPESA_INITIATOR_NAME`, `MPESA_SECURITY_CREDENTIAL` | Daraja B2C (forwarding to the lender) |
| `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` | Africa's Talking SMS reminders |

Set them in your shell, a local `.env.local` (git ignores it), or the Vercel project. Two groups worth calling out:

- **Turso/JWT** — required for anything to work at all.
- **Daraja (M-Pesa)** — required only for the payment flow. Sandbox
  credentials are free/self-serve at developer.safaricom.co.ke. **Read the
  header comment in `src/lib/mpesa.ts` before touching `MPESA_ENV=production`**
  — it documents a real finding about how STK Push actually works (funds
  transit Fungu's own shortcode before being forwarded to the lender via
  B2C) that affects the regulatory question in `MVP-PRD.md` §6.

## API routes

| Route | Purpose |
|---|---|
| `POST /api/auth/register`, `/login` | Phone + PIN auth, returns a JWT |
| `POST /api/debts`, `GET /api/debts` | Create a debt / list your ledger |
| `GET /api/debts/[id]` | Detail: status, repayments, guarantor |
| `POST /api/debts/[id]/guarantor` | Invite a guarantor |
| `PATCH /api/debts/[id]/guarantor` | Guarantor accepts/declines |
| `POST /api/debts/[id]/repayments` | Pay via STK Push or record manually |
| `POST /api/mpesa/callback` | Daraja's STK Push result webhook |
| `POST /api/mpesa/b2c-result`, `/b2c-timeout` | Daraja's B2C webhooks |
| `GET /api/cron/reminders` | Daily job (see `vercel.json`) — one soft reminder per overdue debt, ever |

## Known v1 gaps (not silently skipped — tracked here and in MVP-PRD.md §9)

- No SMS/push delivery for guarantor invites or reminders yet — needs an
  SMS provider (e.g. Africa's Talking). The app-side data model and API
  are ready; only the actual notification send is stubbed (see `TODO`
  comments in `guarantor/route.ts` and `cron/reminders/route.ts`).
- Daraja callback routes aren't yet restricted to Safaricom's IP ranges.
- B2C disbursement failures are logged, not automatically retried or alerted on.
