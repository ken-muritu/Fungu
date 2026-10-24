# Fungu

Track a debt between two people — with a due date, an optional guarantor, and a direct mobile-money payment request — so the debt gets settled instead of quietly wrecking the friendship. Kenya-first, built on M-Pesa/STK Push.

See [`BRAINSTORM.md`](./BRAINSTORM.md) for the full brainstorm and due-diligence doc (market validation, competitive landscape, regulatory read, naming research, tech stack notes), and [`MVP-PRD.md`](./MVP-PRD.md) for the actual v1 scope, core user flow, and open risks.

**Regulatory note, updated during the build:** the original framing was "the app never holds funds." Building the actual STK Push integration surfaced that this isn't quite right — Safaricom's public API can only push a payment prompt into a business shortcode, so a borrower's payment lands in Fungu's own account first and is then forwarded to the lender via a second (B2C) call. Funds transit a Fungu-controlled account, briefly. See the header comment in [`server/src/lib/mpesa.ts`](./server/src/lib/mpesa.ts) and §6 of `MVP-PRD.md` — this needs a lawyer's read before any real money moves through it, and the regulatory question is now more specifically about Payment Service Provider treatment, not just DCP licensing.

## Code

- [`app/`](./app) — Flutter client (Android + iOS from one codebase), see `app/README.md`
- [`server/`](./server) — Next.js API backend (Turso/Drizzle), see `server/README.md`
- [`.github/workflows/build-apk.yml`](./.github/workflows/build-apk.yml) and [`build-web.yml`](./.github/workflows/build-web.yml) — build the release APK and the web (PWA) bundle in CI

`research/` holds supporting research pulled in to inform the brainstorm. It lists videos and channels with their public stats. Video transcripts and audience comments were used during the research but are not included here; the scripts can fetch them again.
- `youtube-research.md` — scoped to Fungu's specific peer-debt/IOU themes (Fuliza/debt culture, CBK/DCP regulation, chama/P2P lending, STK Push, financial literacy, competitor bill-splitting apps)
- `youtube-research-expansion.md` — broader pass: the wider Kenya startup ecosystem, African fintech beyond Kenya (Flutterwave, Paystack, Chipper Cash, OPay), global consumer money-app patterns (Venmo, Cash App, Revolut, BNPL) for feature/UX inspiration, and money-tech infrastructure (embedded finance, USSD, super apps, neobanks)
- `youtube-research-channels.md` — channel-level deep dive on Financially Incorrect, Matt & Ari, and Y Combinator plus 32 related channels discovered from them (full upload histories, stats, comments) — not just keyword search hits
- `youtube-research-buildability.md` — build-and-ship focus: Programming with Mosh + related dev channels, startup-failure postmortems, and the Flutter/React Native/PWA/APK delivery decision
- `youtube-research-channels-2.md` — Tano (AI company building in public), Starter Story (**complete** upload history, ~495 videos), Greg Isenberg, plus 16 related channels (Dan Martell, Chris Koerner, The Diary Of A CEO, and others)
- `youtube_search.py` / `youtube_search_expansion.py` / `youtube_channels.py` / `youtube_search_buildability.py` / `youtube_channels_2.py` — the scripts, reusable, add query/handle/channel entries and re-run

## Status

- **Built:** the MVP v1 code. That's the Flutter client (Android, plus a web/PWA build), the Next.js + Turso API with phone + PIN auth, the debt ledger, guarantors, one soft SMS reminder per overdue debt (Africa's Talking), and the M-Pesa STK Push + B2C integration.
- **Deployed (manual Vercel deploys):** web app at [fungu-web.vercel.app](https://fungu-web.vercel.app), API at [fungu-api.vercel.app](https://fungu-api.vercel.app).
- **Before real money moves through it:** the payment flow needs the legal review described above (PSP and DCP questions), and the name still needs a trademark check. See Open Questions in `BRAINSTORM.md` and §9 of `MVP-PRD.md`.

Name: **Fungu** (Swahili: share, portion, installment).

## Licence

Copyright © 2026 Kennedy Muritu. All rights reserved. The code is public to read, not to reuse. See [LICENSE](LICENSE).
