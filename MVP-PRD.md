# Fungu — MVP PRD

**Status:** Draft, pre-build
**Owner:** Ken M.
**Date:** 24 Aug 2026

## 1. One-liner

Fungu helps two people track a debt between them — with a due date, an optional guarantor, and a direct mobile-money payment request — so the debt gets settled instead of quietly wrecking the friendship.

## 2. The actual thesis (not "formalize peer lending")

This is not pitched as "make informal lending formal." Informality is fine when it works. Fungu exists for the failure mode: vague terms, no real agreement, awkward reminders that never get sent, resentment building silently until the friendship absorbs the cost instead of the money getting repaid.

Two things in the research directly validate this framing over the earlier one:
- The Co-op Bank Foundation session's live Q&A flagged "pity spending" — helping someone out with a vague expectation of repayment, no real terms — as the actual habitual failure pattern (see `BRAINSTORM.md`, financial-literacy session section).
- Real audience sentiment (the "DEBT OF SHAME" comment thread, `research/youtube-research.md`) shows the anger and damage that shows up when debt between people goes bad and collection gets ugly. Structure isn't distrust here — it's what prevents that outcome.

**Design consequence:** every product decision below should be judged against "does this help two people stay friends while a debt gets settled," not "does this maximize lending volume" or "does this look like a fintech app."

## 3. Target scenario (this determines scope — read carefully)

Not Fuliza-sized micro-debt (avg KES 218, repaid in days). That volume is too small and too fast for a due-date/guarantor flow to make sense — nobody adds a guarantor for KES 200.

**The target debt:** the kind that lingers — covered rent, a wedding contribution, "I got you, pay me back next month," a few thousand shillings that's still unpaid two months later and has started to feel awkward to bring up. Slower-burn, higher-stakes-to-the-relationship, exactly where silence does the most damage.

This reframes MVP scope: the product should feel appropriate for a debt someone would actually feel *nervous* not tracking, not for splitting a KES 150 boda fare.

## 4. MVP scope

### In scope (v1)

| Feature | Why it's in v1 |
|---|---|
| Create a debt: counterparty (phone number), amount, purpose, due date | The core loop. Without this there's no product. |
| Pre-agreement checklist (short form) before a debt is created | Directly modeled on the Co-op Bank Foundation checklist already validated in `BRAINSTORM.md`. Cheap to build, high credibility, and it's the moment most likely to actually change behavior (catching a bad loan before it's made, not after). |
| Optional guarantor | Guarantor is *invited*, sees the same terms, can accept or decline. Optional, not required — requiring it on every debt adds friction and a second onboarding to every single use of the app, which risks killing adoption of the core loop before it's proven. |
| STK Push payment request | The borrower gets a native M-Pesa PIN prompt to pay the lender directly — Fungu orchestrates the request but the money moves phone-to-phone, never through a Fungu-held balance. This is load-bearing for the "ledger, not lender" regulatory position (see §6) — do not build a version of this that touches a company paybill or holds funds, even temporarily. |
| Simple running ledger | Per-counterparty view: what's owed to you, what you owe, status (pending / partial / paid / overdue). No dashboard, no analytics, just the list. |
| Partial / installment repayment | Real repayment rarely happens in one shot. Cutting this would make the ledger lie about reality on day one. |
| Non-shaming reminders | Soft, plain-language nudges on/after the due date. No red "OVERDUE" styling, no escalating tone. This is a brand differentiator, not a nice-to-have — see §2. |

### Explicitly out of scope for v1 (backlog, not forgotten)

| Feature | Why it waits |
|---|---|
| Personal lending cap ("I can lend up to KES X/month") | Real feature, from the "black tax" boundary-setting research — but it's a v1.1 layer on top of a core loop that doesn't exist yet. |
| Soft trust signal ("settled 12/12 on time") | Meaningless with zero data on day one. Revisit once there's real repayment history to show. |
| M-Pesa statement import for onboarding | Genuinely useful (surfaces debts people are already informally tracking) but it's a second, complex integration. Ship the core loop manually first; add import once the core loop is proven worth adopting. |
| Group / chama lending | Different product shape (many-to-many, not 1:1). Explicitly out — Chamasoft etc. already serve this; don't blur Fungu's positioning. |
| Any credit-scoring or CRB-adjacent feature | Crosses straight into DCP-regulated territory. Never build this without the regulatory question in §6 being resolved first, and probably not even then. |
| Native mobile app (APK) | See §7 — PWA first, native app is a fast-follow decision once the core loop has real usage, not a v1 requirement. |
| Multi-currency / non-Kenya markets | Fungu's whole value prop (STK Push, Swahili naming, KES-denominated social norms) is Kenya-specific by design. Not a v1 concern. |

## 5. Core user flow (v1)

1. **Start a debt.** Pick a contact (phone number), enter amount, purpose (free text), due date.
2. **Checklist.** Before the debt is created, a short screen: can they actually afford to lend this / what happens if it's not repaid on time / is a guarantor wanted. Not a hard gate — a moment of friction that's supposed to be useful, not bureaucratic.
3. **Optional guarantor.** If added, they get a message with the terms and a yes/no.
4. **Debt is live.** Both sides see it in their ledger. Borrower can pay any time (full or partial) via STK Push; lender can send a payment request the same way.
5. **Due date passes without full repayment.** A single soft reminder goes to the borrower (and guarantor, if any). No repeated nagging, no shame-toned copy.
6. **Debt resolves.** Marked paid when balance hits zero. That's it — no scoring, no badge, no "streak" mechanic in v1.

## 6. Regulatory posture — this is a constraint, not a feature

Per `BRAINSTORM.md`'s regulatory read: an app that only *records* an agreement between two people and pushes a payment request that settles directly between their own mobile money accounts — never holding funds, never itself extending credit — sits structurally closer to a ledger (Splitwise) than a lender (Tala), and likely falls outside CBK's Digital Credit Providers Regulations (2022).

**This is a hypothesis, not a confirmed legal position.** It has NOT been confirmed by a lawyer yet. This PRD treats it as a hard constraint on the payment architecture (never touch funds, never extend credit on a missed payment, never hold a platform balance) specifically so that when legal confirmation happens, the product doesn't need to be re-architected. Confirming this with a Kenyan fintech lawyer is a **blocking dependency before the STK Push flow goes live in production** — it can be built and tested in sandbox before that, but should not process real money for real users until confirmed.

## 7. Tech stack

**Recommendation: Next.js + Turso (via Drizzle) on Vercel, shipped as an installable PWA.**

Reasoning, expanding on `BRAINSTORM.md`'s tech stack notes:
- Single codebase, fastest path to something real users can touch.
- A PWA covers "web app" and "something installable on a phone" simultaneously — satisfies the "ship it as an APK or web, whatever" goal without committing to two client codebases before the core loop is validated.
- Native app (Flutter or React Native, per `research/youtube-research-buildability.md`'s comparison research) becomes the right call once push notifications and App/Play Store presence actually matter for retention — not before. iOS PWA push is the known weak point; that's the trigger condition for going native, not a v1 blocker (most of the target user base is Android/M-Pesa-first anyway).
- Avoid the Django+Vercel combination flagged as friction in `BRAINSTORM.md` — no reason to introduce a second backend stack for an MVP this size.

**Real, non-trivial dependency:** STK Push requires Safaricom Daraja API access — sandbox access is fast, but production access requires a registered business shortcode/paybill and Safaricom's approval process, which has real lead time. This should be kicked off early, in parallel with building, not treated as a last step.

## 8. Success signals for MVP

Not vanity metrics — signals that the core thesis is actually working:

- **Debts created** — is anyone actually reaching for this instead of staying silent/informal?
- **Guarantor add rate** — validates whether that feature is pulling its weight or just friction.
- **On-time vs. late vs. abandoned repayment rate** — does structure actually change repayment behavior, or does it just add ceremony to the same outcomes?
- **Repeat use** — does someone create a second debt after their first one resolves? This is the real retention signal for a low-frequency product like this.
- **Qualitative** — did anyone report the app helped them avoid an awkward conversation, or helped a debt get settled where it otherwise wouldn't have? Worth a direct, unscientific "how did that go" follow-up with early users rather than waiting for a formal survey system.

## 9. Open risks / assumptions still untested

1. **Adoption friction at debt-creation.** Nobody has watched a real person go through the create-a-debt flow yet. Cheapest next validation step: a clickable mock of the flow shown to 8-10 people who've actually lent to or borrowed from a friend recently (per the earlier discussion) — not more desk research.
2. **Guarantor social dynamics.** Asking someone to be a guarantor is itself a socially loaded request. Untested whether people will actually use this, or whether it becomes a feature nobody touches.
3. **DCP regulatory hypothesis** — see §6, not yet lawyer-confirmed.
4. **STK Push production approval timeline** — unknown until the Daraja business application is actually filed.
5. **Naming** — "Fungu" hasn't cleared a formal KIPI trademark search yet (`BRAINSTORM.md` §Open questions). Do this before any public launch, not after.

## 10. Explicit non-goals

Worth stating plainly so scope doesn't creep back in mid-build:
- Fungu is not trying to be a lender, a credit bureau, or a savings/investment product.
- Fungu is not trying to compete with Chamasoft/M-Changa on group money management.
- Fungu is not optimizing for lending *volume* — a version of this product that's "successful" by maximizing total KES lent through the platform has drifted from the actual thesis in §2.
