# Peer Debt / IOU App — Brainstorm & Due Diligence

**Date:** 17 Aug 2026 (naming research updated 17–18 Aug 2026; session validation added 20 Aug 2026)
**Idea:** a Kenya-first peer-to-peer debt/IOU tracking app — "niokolee mia" formalized, with guarantors, reminders, and native mobile-money payment initiation.

## Market validation (researched 17 Aug 2026)

- **Fuliza (Safaricom overdraft):** 17.7M users in FY26 (44% of M-Pesa's 40M base), up from 0.7M in FY20 — a 24x jump in 6 years, +9.8M users in the last year alone. Average loan size has *fallen* from KES 623 to KES 218 over that period even as total disbursement hit a record KES 1.47 trillion (FY26). Reading: massive, high-frequency, small-ticket borrowing — exactly the "niokolee mia" pattern, at national scale.
  - [Fuliza Skyrockets to 17.7 Million Users While Loan Sizes Shrink by 65%](https://techweez.com/2026/05/08/fuliza-revenue-fy26/)
  - [Kenyans 'Fuliza' record Sh1.4 trillion loans for food, rent and fees](https://nation.africa/kenya/business/kenyans-fuliza-record-sh1-4-trillion-loans-for-food-rent-and-fees-5452126)
  - [Kenya's Fuliza Usage Rises to Ksh3.3 Billion Per Day](https://www.money254.co.ke/post/kenyas-fuliza-usage-rises-to-ksh3-3-billion-per-day-as-mshwari-declines-news)
- **Young Kenyans (20-29):** 43% borrow just to cover everyday expenses (Old Mutual Financial Wellness Monitor 2025); mobile money loans are the largest credit source at 39%; 26% borrow to finance business/stock; only 36% have 3+ months of savings runway.
  - [Close to half of young Kenyans borrowing for daily needs](https://www.the-star.co.ke/business/2026-08-14-close-to-half-of-young-kenyans-borrowing-for-daily-needs-report)
  - [43% of Young Kenyans Borrow to Survive Despite Having Jobs](https://www.kdrtv.co.ke/lifestyle/43-of-young-kenyans-borrow-to-survive-despite-having-jobs/)
- **Sentiment risk:** youth-debt coverage repeatedly frames app-based digital lending as a debt trap / predatory pattern — brand needs to position clearly *against* that association, not adjacent to it.
  - [Kenya: The cycle of mobile app loans is costing the youth its health and finances](https://www.theafricareport.com/149766/kenya-the-cycle-of-mobile-app-loans-is-costing-the-youth-its-health-and-finances/)
  - [How Young Kenyans Are Getting Trapped in Digital Loan Debt](https://fineducke.com/articles/1100/how-young-kenyans-get-trapped-in-digital-loans)

## Competitive landscape

| Category | Players | Why it's not the same product |
|---|---|---|
| Institutional digital lenders | Tala, Branch, M-Shwari, Fuliza | Platform *is* the lender, charges interest, CBK-licensed DCPs |
| Group/chama money management | Chamasoft, M-Changa, SmartChama, MyChama | Built for group contributions/loans, not 1:1 peer debt |
| Bill-splitting / shared expense | Splitwise, Halfway, Even, Are We Even | Splits shared costs; no terms/due date/guarantor concept |

**Apparent whitespace:** structured 1:1 peer lending (terms, due date, guarantor, reminders) with a direct push into existing mobile money rails, without the app itself acting as lender or holding funds. No product found that combines all of these for the Kenyan market — caveat: search-based, not exhaustive; worth manually checking Play Store listings before committing.

## Key technical finding: STK Push > deep-linking

Original idea was a popup letting the borrower choose M-Pesa/Airtel/bank and deep-link out with prefilled details. Better mechanism already exists: Safaricom's Daraja API **STK Push** lets a third-party app trigger a PIN-entry prompt *directly on the recipient's phone* ("Pay KES 500 to X? Enter M-Pesa PIN") without opening any app — round trip ~4-8 seconds. Airtel Money has an equivalent. This should likely be the core payment interaction, not one option among several.
- [How M-Pesa STK push works](https://www.angaze.co/blog/daraja-stk-push/)

## Regulatory read (not legal advice — confirm with counsel before building payment flows)

CBK's Digital Credit Providers Regulations (2022) require licensing for platforms that *themselves* extend credit or hold funds/collateral. An app that only records agreements between two people, sends reminders, and pushes a payment request that settles directly between their own mobile money accounts (never touching the money) looks structurally closer to a ledger (Splitwise) than a lender (Tala). This is a hypothesis to get confirmed by a Kenyan fintech lawyer — crossing into escrow, a platform balance, or the app extending credit on missed payments would flip this into DCP territory.
- [Kenya: Regulation of Digital Lenders in Kenya — Bowmans](https://bowmanslaw.com/insights/kenya-regulation-of-digital-lenders-in-kenya/)
- [Central Bank of Kenya (Digital Credit Providers) Regulations 2022](https://www.centralbank.go.ke/2022/03/21/central-bank-of-kenya-digital-credit-providers-regulations-2022/)
- Related, from CBK's proposed digital-lender rules (researched 18 Aug 2026): defaults under KES 1,000 are barred from CRB listing, and a grace period (~6 months) applies before any listing — relevant to Ken.M's own small, frequent Fuliza draws.

## Feature brainstorm

- Core loop: pick contact → set amount/purpose/due date → optional guarantor co-sign → STK-push payment request → shared running ledger.
- Guarantor visibility + nudges if due date lapses.
- Non-shaming reminder tone — likely brand differentiator given the "debt collector" reputation of existing loan apps.
- Partial/installment repayment.
- Soft trust signal ("settled 12/12 on time with friends") instead of a CRB-style credit score — avoids DCP-style credit-scoring territory.
- Statement import/onboarding: an M-Pesa statement parser (categorizing Send Money / Received Money / Fuliza / counterparty extraction) to let users scan a statement and surface debts they're already informally tracking.
- **New, from the 20 Aug financial literacy session (see below):** an embedded pre-agreement checklist (purpose, affordability, full cost, what happens if a payment is missed, who the guarantor is and what that means for them) modeled on Co-op Bank Foundation's own responsible-borrowing checklist — shown before a debt is created, not after.
- **New:** an optional personal lending cap/boundary a lender can set for themselves (e.g. "I can lend up to KES X per month") — a direct product mechanic for the "black tax" boundary-setting advice given in the session.

## Naming — full research pass (17 Aug 2026)

Checked 16 candidates for collisions across Kenyan fintech, adjacent African fintech, and global consumer brands. Confirmed collisions (avoid):

| Name | Meaning | Collision found |
|---|---|---|
| Sawa | settled/even | SawaPay (Kenya/Ethiopia/Senegal remittance app) |
| Dhamana | guarantee/surety | Dhamana Guarantee Company + bank product "Mkopo Dhamana" |
| Fadhili | kindness/favor | An actual "Fadhili Loan App" — appears on scam-app blacklists |
| Amini | trust/believe | Amini, funded Kenyan climate-tech startup + AminiPay gateway |
| Imara | firm/strong | Imara Group (Africa/MENA fintech investor), Imarisha SACCO |
| Thabiti | steadfast | Thabiti Finance Co. Ltd — real Kenyan finance company |
| Sarafu | coin/currency | Sarafu-Credit, Kenya's well-documented community cryptocurrency |
| Stawi | thrive/prosper | CBK-backed 5-bank-consortium SME loan app — very well known |
| Stawisha | cause to thrive | Multiple existing quick-cash loan apps already use this |
| Weza | to be able | Weza Tele, existing Kenyan fintech startup; Wezadata |
| Rafiki | friend | Rafiki.API — open-source wallet/payments infrastructure project |
| Wajibu | duty/responsibility | Existing "Wajibu App" on Google Play |
| Ahadi | promise/pledge | Ahadi Corporation (Kenya), an Ahadi app (Tanzania), NGO program, political party |
| Chapa | stamp/slang for cash | Funded, expanding pan-African payment gateway (Ethiopia) |
| Zoa | Sheng slang, "grab/get" | ZOA Energy — major global energy-drink brand; also a Dutch NGO |

Clean or near-clean, in order of preference (as of the first pass):

1. ~~**Owazi**~~ — see reversal below, 18 Aug 2026 deep dive.
2. **Fungu** ("a share/portion") — no operating business found under this name. fungu.com is parked for resale via HugeDomains (not in use, but a reseller purchase is typically a few thousand USD) — `fungu.co.ke` / `fungu.app` more realistic first move.
3. **Tegemea** ("rely on/depend on") — good semantic fit, no fintech collision, but tegemea.com is live as a UK virtual-assistant business (different industry/country, low trademark risk, but the clean `.com` is gone — would need `.co.ke`/`.app`/modified spelling).
4. **Zawadi** ("gift") — mostly clean (Kiva borrower profile, no fintech collision) but semantically off — a gift isn't a debt. Only worth it if brand tone shifts toward generosity rather than accountability.

**Formal verification still needed before committing** (not done here — these are the actual tools):
- Kenya: [KIPI trademark search via eCitizen](https://kipi.ecitizen.go.ke/) — search under Nice Class 9 (software) and Class 36 (financial services). Strathmore's CIPIT also runs a public trademarks database.
- International (if ever relevant): USPTO TESS, WIPO Global Brand Database — both free.
- Also check: Play Store / App Store name availability, and social handle availability, for the final 1-2 candidates.

## Naming deep dive — Fungu vs. Owazi (18 Aug 2026)

Requested: no assumptions, full due diligence on both finalists, plus what each would stand for and how it'd represent visually. Findings below — one of them reversed the earlier read.

### Fungu — held up, got stronger

Verified against multiple Swahili dictionaries (Glosbe, Majstro, WordHippo — not just recalled from memory): core senses are *share, portion, part, lot, allocation, bundle*. Its diminutive **kifungu** (plural **vifungu**) is the ordinary Swahili word for *clause, passage, installment* — "kulipa kwa vifungu" ("to pay in installments") is standard financial Swahili. This isn't a stretched metaphor; it's the actual vocabulary root Kenyans already use for structured repayment. Secondary, unrelated sense: a small sandbank/islet (e.g. Fungu Yasini Island) — neutral, not load-bearing.

Deeper collision pass: still nothing. No lending/fintech/payments company anywhere under this name. Phonetic neighbors ("Fungo" — mushroom-ID/voice-chat app; "Funanga" — unrelated African fintech infra co) aren't real collisions. fungu.com parked/unused; no Play/App Store listing in finance. Instagram/X handle availability blocked automated checking (robots.txt) — a manual 5-minute check, not a gap glossed over.

**What it stands for:** your portion, tracked plainly, paid down in fungu. Reframes debt as a portion someone's carrying, not a moral failure — dignified, precise, linguistically native. Doubles as the in-product noun ("set a fungu with Wanjiru," "3 fungu paid this month") the way "tweet" became both company and object.

**How it could be represented:** circular progress ring as the core visual motif — a portion of a circle filling as a debt clears, which is literally what "fungu" means. Glassmorphic frosted-glass disc icon; warm blue + soft amber accent (avoid red except as the status-color system already uses it — red reads as "debt = danger," fighting the dignity-preserving tone). Lowercase wordmark, rounded sans. Copy tone: "Your fungu with Wanjiru: KES 500, due Friday" — never "YOU OWE."

### Owazi — reversed. Not clean.

The first pass checked "Owazi" itself and found nothing. That was the wrong check: Owazi is one letter from **Uwazi**, a real, common Swahili word for *transparency/openness* — and that word is anything but quiet in this space:

- **Amini AI** (the same funded Kenyan climate-tech company already ruled out under its own name) ships a live Google Play app called **Uwazi** (`com.limited.uwazi`) — a field-data collection tool, not finance, but a real shipped product from a real funded company under that exact name.
- **Nijenge Uwazi** is an actual operating bodaboda asset-financing company in Kenya — the same sector.
- A UX designer independently published a Dribbble case study titled **"Uwazi, a lending app"** — someone else already reached for this exact word for this exact category.
- Recurring Kenyan social search/TikTok chatter — "Is Uwazi a real paying app or fake," "Uwazi App legit" — points to some informal loan-related use of the word carrying scam-adjacent question marks, source unconfirmed.

Net: Owazi would be heard, typed, and searched as "Uwazi" by nearly everyone who encounters it — landing inside a word already claimed by a funded company, a financing business, a competing app concept, and some real trust ambiguity. A near-miss spelling doesn't buy distance from that (Kenyan trademark law weighs confusingly-similar marks, not just exact matches), and it doesn't earn ownership of the transparency meaning either. This is the same trap as Fadhili, arrived at from a different direction.

**If the transparency meaning is genuinely the draw:** better to consider **Uwazi outright**, deliberately, with a lawyer clearing it against Amini's existing (different Nice class) use — rather than a workaround spelling that gets the risk without the meaning.

### Side by side

| | Fungu | Owazi (→ reads as Uwazi) |
|---|---|---|
| Real word? | Yes — verified | No — invented, collides phonetically with a real one |
| Meaning fit | Share/portion/installment — exact match | Transparency — strong fit, but not the word actually used |
| Collisions found | None | Funded startup's live app, a financing company, a competing app concept, scam-chatter |
| Risk level | Low | Higher than first assessed |
| Status | **Primary recommendation** | Drop, or pursue "Uwazi" itself with legal clearance |

## Tech stack notes

Proposed stack (Turso + Vercel + Django) has friction: Django's ORM has no mature official Turso/libSQL backend (Turso's first-class support is JS-side via Drizzle/Prisma); Vercel is serverless/edge-first and not a natural fit for classic Django (WSGI, migrations, admin, sessions).

Two cleaner paths:
1. **All-TS**: Next.js + Turso (via Drizzle) on Vercel — single codebase, PWA-native, fastest path to "web + PWA + marketing site."
2. **Split**: Django API (good for admin panel / dispute handling) hosted on Railway/Render/Fly with Postgres, Next.js/Vercel as marketing site + PWA client calling the API.

Flutter/Dart: hold in reserve rather than starting there — right call once native push/App Store presence is needed (iOS PWA push is still the weak link for a reminders-heavy product), but starting two client stacks at once before validating the idea will slow things down.

## Session validation — Co-op Bank Foundation × OSS "Good Debt vs Bad Debt" webinar (20 Aug 2026)

The session was attended live and its transcript reviewed afterward for anything that validates or shapes the app. This section only captures what's new/actionable for the product.

**Independent validation that peer debt is real debt, not a lesser category** (37:26, Charity Muthemba, Co-op Bancassurance Intermediary Ltd): *"I have a loan that I owe this mobile platform, or even I owe a friend... the repayment date has come and I do not have the money, so I have to borrow to be able to pay."* Mobile-platform debt and friend debt named in the same breath as the same warning sign (rollover). Useful citable line if the "is peer debt a real problem" premise ever needs defending to a skeptic.

**Validation of the core failure mode the app targets** (Q&A, 01:21:27): a live audience question asked how to stop habitual "pity spending" — helping people out with a vague expectation of future repayment, no real agreement or date. This is exactly the undocumented, emotional lending pattern the app's structured terms (amount, due date, guarantor) are designed to replace.

**Reusable feature, not just validation:** the session's pre-loan checklist — why am I borrowing, can I actually afford it, full cost (not just speed), what happens if a payment is missed, who's the guarantor and what does that mean for them, what are the alternatives to borrowing — is close to a ready-made responsible-borrowing flow. Worth surfacing a short version of this checklist *before* a debt agreement is created in-app, and worth citing as the basis ("built on the same checklist Co-op Bank Foundation teaches") for credibility.

**Boundary-setting → product mechanic:** the session's "black tax" advice (decide a fixed, affordable, non-emotional amount you can give/lend consistently, communicate it plainly) maps directly onto a personal lending cap feature — let a user set "I can lend up to KES X per month" as a soft limit inside the app.

**Brand-voice material:** "Debt is like fire — it can cook meals or burn the house down" (Charity's framing); "Winning at money is 80% behavior, 20% head knowledge" (Dave Ramsey, referenced in session). The app's whole thesis — reminders, guarantors, boundaries — is a behavior-change tool first, a ledger second; this framing is good copy inspiration and matches the session's own thesis closely.


## Open questions / next steps

- Run Fungu (and, if pursued deliberately, Uwazi) through the actual KIPI trademark search (link above) before committing
- Confirm DCP licensing boundary with a Kenyan fintech lawyer before building payment flows
- Decide tech stack path (all-TS vs. split Django+Next.js)
- Define MVP scope / core user flow in more detail — the pre-loan checklist from the 20 Aug session is a strong candidate for the first screen after "create a debt"
- Manual Play Store search for existing Kenyan "IOU between friends" apps not surfaced by web search
- Manual Instagram/X handle check for "fungu" (automated fetch blocked by robots.txt)
