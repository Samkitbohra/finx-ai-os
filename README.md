# FinX AI OS

The operating system for India's licensed local lenders — pawnbrokers, gold, vehicle, property, machinery and small-business financiers. One system for loans, accounts, compliance and collections, with an AI assistant for staff, an AI collections agent, and an app for borrowers.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL · Drizzle ORM · Tailwind · Anthropic API.

---

## What's in it

| Module | Where | What it does |
| --- | --- | --- |
| Origination & KYC | `/console/borrowers`, `/console/loans/new` | Borrower onboarding (PAN, last-4 Aadhaar only, CKYC), per-channel consent, language. Asset capture for gold (net weight, purity, assay, packet), vehicle (RC, chassis, engine, insurance), property (survey no., title papers), machinery (serial, supplier invoice). Live LTV against tiered caps, schedule preview. |
| Approvals | `/console/approvals` | Maker–checker: the officer who created a loan cannot approve it (owners/admins excepted). |
| Disbursal | loan page | Press-and-hold confirmation. Processing fee + GST deducted, invoice issued, schedule generated, double entry posted, loan agreement generated. |
| Servicing & schedules | `src/lib/interest.ts` | Flat, reducing (EMI) and daily-accrual (actual/365) interest; monthly, weekly, daily and bullet repayment. Penal interest after grace. Payments applied penalty → interest → principal. Prepayment lowers future interest on reducing and daily loans. DPD, payoff, next due. Receipt reversal rebuilds the loan from its schedule. |
| Collections & voice agent | `/console/collections`, `src/server/agent.ts` | Daily run picks due and overdue loans and contacts borrowers by stage (WhatsApp → AI call → auction notice for gold). Contact rules are enforced before anything is sent: permitted hours (IST), consent per channel, daily limit, do-not-contact. Every attempt, including held-back ones, is logged. Promise-to-pay and call outcomes. |
| Conversational AI | `src/server/channels.ts`, `/api/webhooks/*` | WhatsApp Cloud API, SMTP email from the lender's own mailbox, any HTTP SMS gateway, any HTTP voice-agent provider. Inbound replies are matched to the loan and classified (paid / more time / dispute). WhatsApp failure falls back to SMS. |
| Scripts in 12 languages | Settings → Scripts & languages | One approved script per language (Hindi and Tamil included; others translated from English via the API and approved by a manager). |
| Accounting & books | `/console/accounting`, `src/server/core.ts` | Chart of accounts per lender. Every disbursal, receipt, fee, reversal, write-off and auction posts a balanced journal. Day book, trial balance, P&L, balance sheet, ledgers, GST summary (interest exempt, charges taxable), manual journals with TDS, invoice re-issue at corrected GST. Exports: Tally XML, CSV. |
| Payments | loan page, borrower app, API | Cash/UPI/NEFT/cheque receipts; UPI intent link for borrowers; idempotent payment API for gateways. |
| Compliance & registers | `/console/compliance`, `/console/registers` | KYC re-verification queue, bureau data file (CIBIL/CRIF/Equifax/Experian layout), recovery-conduct evidence, audit trail, pledge register and loan register (print/CSV). |
| Collateral & vault | `/console/collateral` | Everything pledged, packet numbers, gold weight in vault, insurance expiry and auction-review flags. |
| Borrower app | `/app` | Phone + OTP sign-in. Their own ledger: balance, rate, schedule, receipts, repayment score, "Pay ₹100 today · save ₹X", UPI payment and UTR report. English, Tamil, Hindi UI. Installable (PWA manifest). |
| Analytics & MIS | `/console/analytics` | Book, yield, NPA and 30+ by branch, product and officer; monthly targets and incentives. |
| Branches, staff & roles | Settings | Owner, admin, branch manager, loan officer, accountant, collections, auditor (read-only). Branch-scoped data for branch roles. |
| Vault, audit & API | `/api/documents`, `/api/v1` | Document vault with SHA-256 seal and tamper log, counter-signature capture. Full audit log of every change (who, via UI/chat/API/agent, before/after). REST API with hashed API keys. |
| FinX AI | `/console/ai`, `src/server/ai.ts` | Staff type what they want. Read tools answer from live data; write tools (create borrower/loan, record payment, fix a borrower, re-issue an invoice, contact a borrower) show a confirmation card and only run after the user confirms. Respects the user's role. Works in limited mode without an API key. |

## Run it locally

Requirements: Node 20+, PostgreSQL 14+.

```bash
cp .env.example .env            # set DATABASE_URL and AUTH_SECRET
npm install
npm run db:push                 # create tables
npm run db:seed                 # demo lender with ~6 months of history
npm run dev                     # http://localhost:3000
```

Demo sign-ins (password `finx1234`): `owner@`, `admin@`, `manager@`, `officer@`, `accounts@`, `collections@`, `auditor@finx.demo`.
Borrower app: open `/app/login` and use any seeded borrower's mobile number — in simulation mode the OTP is shown on screen.

`npm run db:reset` wipes and reseeds. `npm test` runs the interest-engine tests.

## Deploy

Recommended: **Vercel + Neon (or Supabase) Postgres**.

1. Create a Postgres database and copy its connection string (with `sslmode=require`).
2. Import this repo into Vercel. Set the environment variables from `.env.example` (at minimum `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`; add `CRON_SECRET` for the daily job).
3. From your machine, with `DATABASE_URL` pointing at the new database: `npm run db:push && npm run db:seed` (skip the seed for a real lender).
4. `vercel.json` schedules `/api/cron/daily` at 07:30 IST: refresh DPD and scores, expire overdue KYC, run the collections agent.

Netlify also works with its Next.js runtime; add the cron through Netlify Scheduled Functions or any external scheduler calling `/api/cron/daily` with `Authorization: Bearer $CRON_SECRET`.

**Documents:** files are written to `STORAGE_DIR` on disk. Serverless hosts have no persistent disk, so in production swap `put`/`getFile` in `src/server/documents.ts` for S3, R2 or Supabase Storage (two functions).

## Connecting the channels

Every channel runs in **simulation mode** until its credentials are set: messages are rendered, rule-checked and logged on the loan, but not sent.

| Channel | Env | Notes |
| --- | --- | --- |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` | Meta Cloud API. Business-initiated messages need templates approved in WhatsApp Manager; register the same wording as the approved scripts. Webhook: `/api/webhooks/whatsapp`. |
| SMS | `SMS_WEBHOOK_URL`, `SMS_API_KEY` | Any HTTP gateway (POST `{to, text, ref}`). DLT template registration is required in India. Inbound: `/api/webhooks/sms` (`{from, text}`). |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Gmail app password or any SMTP account, so mail goes out under the lender's domain. |
| AI voice | `VOICE_PROVIDER_URL`, `VOICE_PROVIDER_KEY` | Any outbound voice-agent provider. FinX POSTs `{to, name, language, script, ref, callback_url}`; the provider POSTs `{ref, outcome, transcript, ptp_date, ptp_amount, duration_sec}` to `/api/webhooks/voice`. |
| FinX AI | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Chat with tools and script translation. |

## REST API

Create a key in **Settings → API**, then send `Authorization: Bearer <key>`.

```
GET  /api/v1/borrowers?phone=9840012345
GET  /api/v1/loans?status=ACTIVE&overdue=1
GET  /api/v1/loans/{loanNo}
GET  /api/v1/loans/{loanNo}/dues
POST /api/v1/loans/{loanNo}/payments   {"amount": 4180, "mode": "UPI", "reference": "UTR412345678901"}
```

Payments are idempotent on `reference`, so a gateway can retry safely.

## How the money works

- Amounts are computed in integer paise; the database stores `NUMERIC(14,2)`.
- **Flat:** interest = principal × rate × tenure, spread evenly. **Reducing:** standard EMI on the outstanding balance. **Daily:** interest accrues on the actual outstanding for the actual days (actual/365); a part-payment of interest moves the "interest paid to" date forward by the whole days it covers.
- Penal interest: `penalRate` % a year on overdue instalment amounts, only after `graceDays`.
- Allocation order: penal interest → interest → principal (oldest instalment first). Extra money on reducing/daily loans reduces principal and re-spreads the remaining schedule; on flat loans it pays the next instalments in advance.
- Interest income is recognised when received (cash basis). Processing charges are invoiced with GST at disbursal.
- Postings: disbursal Dr Loans / Cr Cash-or-Bank, Fee income, GST output · receipt Dr Cash-or-Bank / Cr Penal income, Interest income, Loans, Unapplied (excess) · write-off Dr Bad debts / Cr Loans · auction surplus Cr Payable to borrower, shortfall Dr Loss on auction.

## What still needs real-world setup

- **Channels** need the lender's own accounts (WhatsApp Business, SMS with DLT, a voice-agent provider, SMTP).
- **Bureau files** use a common layout with all the fields bureaus ask for. Each bureau's exact upload format (e.g. CIBIL's) is a column mapping on top, and submission runs under the lender's own bureau membership.
- **Aadhaar eSign / e-mandate** need an ESP and an NPCI partner; today the agreement is counter-signed at the branch with a drawn signature and a tamper-evident seal.
- **Gold rate** is entered on the loan form; plug in a daily rate feed if you want it automatic.
- **Statutory register formats** follow the columns most state pawnbroker / money-lending rules prescribe; check them against the specific state's forms before an inspection.
- **Self-serve signup** for new lenders isn't built; a lender is created by the seed or an admin script. The data model is multi-tenant (everything is scoped by organisation).
- **The repayment score** is internal to FinX (300–900 from repayment behaviour). It is not a credit bureau score.

## Code map

```
src/db/schema.ts          data model (24 tables)
src/lib/interest.ts       interest engine (pure, unit-tested)
src/lib/money.ts, dates.ts   paise arithmetic, IST business dates
src/lib/auth.ts, permissions.ts   sessions, roles, branch scoping
src/server/loans.ts       borrowers, loans, disbursal, payments, reversal, write-off, auction, invoices
src/server/core.ts        running numbers, audit log, chart of accounts, journal posting
src/server/reports.ts     portfolio, ageing, trial balance, P&L, balance sheet, day book, GST
src/server/agent.ts       collections agent, contact rules, scripts, inbound replies
src/server/ai.ts          FinX AI tools and confirmation loop
src/server/compliance.ts  bureau file, KYC queue, conduct log, pledge register
src/server/documents.ts   vault, agreements, signatures, tamper log
src/app/console/*         staff console
src/app/app/*             borrower app
src/app/api/*             REST API, webhooks, exports, cron
scripts/seed.ts           demo lender
```
