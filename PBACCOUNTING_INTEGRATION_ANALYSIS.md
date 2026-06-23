# PBAccounting Books → Pipeline AI Integration Analysis

**Date:** 2026-06-23
**Scope:** Read-only comparison of `pipeline-ai` (field-service SaaS) and `pbaccounting-books` (Polar Bear Agency's Zoho replacement).
**Source paths:**
- Pipeline AI: `/sessions/vibrant-magical-knuth/mnt/NYSD - APP/pipeline-ai`
- PBAccounting: `/tmp/pbaccounting-books`
- Verified files: `pipeline-ai/supabase/migrations/*.sql`, `pipeline-ai/src/lib/tier-limits.ts`, `pbaccounting-books/src/db/schema.ts` (49 KB, ~1170 LOC, ~40 tables), `pbaccounting-books/src/auth.ts`, `pbaccounting-books/src/middleware.ts`, `pbaccounting-books/CLAUDE.md`.

---

## 1. Tech stack alignment

| Concern | Pipeline AI | PBAccounting |
|---|---|---|
| Framework | Next.js 16.2.3, React 19.2.4, App Router | Next.js 16.2.6, React 19.2.4, App Router + Turbopack |
| TypeScript | yes (5.x, strict) | yes (5.x, strict) |
| Styling | Tailwind v4 + shadcn/ui (`shadcn 4.2.0`) + `tw-animate-css`, `base-ui/react`, `motion` | Tailwind v4 — **no shadcn**; hand-rolled components + `clsx`/`tailwind-merge`/`lucide-react` |
| Database | Supabase Postgres (project `zabfuqxjjunsppotfrel`) | **Neon Postgres 17** via Vercel Marketplace (eu-central-1) |
| ORM/queries | Raw Supabase client (`@supabase/ssr`, `@supabase/supabase-js`) | **Drizzle ORM 0.36** + drizzle-kit (`src/db/schema.ts` is source of truth) |
| Auth | Supabase Auth | **Auth.js v5 / NextAuth beta** (`next-auth@5.0.0-beta.25`) + Drizzle adapter, Resend magic-link + owner username/password (Audit 18) + TOTP 2FA |
| Storage | Supabase Storage (`org-logos`, etc.) | **Vercel Blob** (`@vercel/blob`, `pbaccounting-books-blob` store) |
| Multi-tenancy | RLS by `organization_id`; helper `public.get_user_org_id()` + per-table policies in every migration | **None** — single-tenant install, no `organization_id` on any table |
| Email | Resend 6.10 | Resend 4.0 |
| AI | Anthropic SDK 0.88 (job report/invoice gen, equipment AI learning) | Anthropic SDK 0.32 (receipt OCR + AI fuzzy bank-match) |
| Stripe | Stripe Connect Express (Migration 004) | none |
| PDF | `jspdf` + `jspdf-autotable` (4 themes) | `@react-pdf/renderer` + branded print routes |
| Background jobs | none (cron only via Vercel) | Vercel Cron: `/api/cron/{depreciation,purge-trash,overdue,recurring-expenses,webhook-worker,reminders,recurring}` |
| Deploy | Vercel | Vercel (project `prj_zRxDw3gMVAuCBARk5hfqkS3mF6lW`) |

**Stack mismatches that materially affect integration cost:**

1. **DB host:** Supabase (with `auth.users` FK, RLS, helpers) vs Neon (pure Postgres). Cannot share a database without a full migration of one side.
2. **ORM vs raw queries:** Drizzle's schema-as-code conflicts with Pipeline AI's hand-written `.from('table').select(...)` style. Sharing query code is impossible without a layer rewrite.
3. **Auth provider:** Supabase Auth (cookie-based, RLS-aware) vs NextAuth + Drizzle adapter (session table). User IDs are typed differently (`uuid` referencing `auth.users` vs Auth.js `text` UUID self-generated).
4. **Tenancy model:** RLS-by-`org_id` everywhere vs effectively zero tenancy — a global rip-and-replace if merged.
5. **Storage:** Migrating Vercel Blob → Supabase Storage (or vice versa) means moving every PDF/receipt URL + signed-URL logic.

---

## 2. Entity inventory — PBAccounting

Source: `pbaccounting-books/src/db/schema.ts`. None of these tables carry `organization_id`; tenancy is implicit (single PBA install).

All tables live in `src/db/schema.ts` (~1170 LOC). None carry `organization_id`.

**Master data:** `clients` (displayName, currency, taxTreatment, portalUserId, language) · `vendors` · `items` (defaultRateEur/Usd, isSellable/Purchasable, accountId→CoA) · `chartOfAccounts` (19-type enum incl. asset/liability/equity/income/expense/AR/AP/COGS/fixed_asset/stock, parentAccountId self-FK) · `taxRates` · `bankAccounts` (importerType enum for Raiffeisen/BKT/Payoneer CSV+PDF) · `settings` (singleton, `id=1`) · `fixedAssets` + `depreciationEntries` (4 methods, monthly cron).

**Transactional:** `invoices` (status: draft/sent/viewed/partial/paid/overdue/cancelled/written_off; currency, exchangeRate, balance, isLocked, fxRateToBase, language en|al, reminderLevelsSent int[]) + `invoiceLines` · `bills` + `billLines` (AP) · `expenses` (paidThroughAccountId→bankAccounts, receiptUrl Blob, receiptOcrData jsonb, isBillable, customerId, projectId) + `expenseSplits` (per-account allocation) · `payments` (against invoices; mode enum bank_transfer/card/cash/payoneer/wire/other; depositAccountId, bankCharges, creditNoteId) · `creditNotes` + `creditNoteLines` (status: draft/issued/applied/refunded/void) · `estimates` + `estimateLines` (8-state lifecycle, convertedInvoiceId) · `recurringInvoices` + `recurringExpenses` (frequency enum, nightly cron) · `invoiceNumberSequences`, `estimateNumberSequences` (per-year) · `projects` · `timeEntries` (links to invoiceLineId on bill-out).

**Banking:** `bankStatements` (file Blob, period, opening/closing) · `transactions` (matchStatus: unmatched/auto_matched/suggested/manual_matched/ignored; matchMethod rule/ai/manual; category enum of ~25 incl. government_grant, bank_fee, rent, utilities, software_subscription, etc.). No formal `reconciliations` table.

**Reports — all computed, none stored.** P&L, AR aging, VAT, sales-by-customer, sales-by-item, payments-received, expense-by-vendor, expense-by-category, monthly-health. Per CLAUDE.md Audit 32 (2026-06-01), P&L mirrors Zoho's Income → COGS → Gross Profit → OpEx → Operating Profit → Non-Op → Net, driven by `chart_of_accounts.account_type` LEFT JOIN `expense_splits`. **No `journal_entries` / general ledger table — single-sided posting only.**

**System:** Auth.js standard (`users` text PK, `accounts`, `sessions`, `verificationTokens`) · `userPreferences` (savedViews, TOTP secret/backup-codes/lockout) · `rememberDevices` (2FA) · `auditLog` (action, tableName, rowId, before/after jsonb, ip, ua) · `notifications` · `emailTemplates` + `emailTemplateRevisions` (per templateKey+language) · `webhooks` + `webhookDeliveries` (HMAC-signed, retry tracking).

---

## 3. Feature coverage vs Zoho Books

| Feature | PBAccounting |
|---|---|
| Chart of accounts (full type set) | **yes** — 19-type enum incl. asset/liability/equity/income/expense + AR/AP/COGS/fixed_asset/stock |
| Double-entry journal entries | **no** — no `journal_entries` or `ledger_entries` table; reports compute from `expense_splits + transactions.category + payments + invoices` |
| Invoices (AR) | **yes**, far richer than Pipeline AI's (see §4) |
| Bills (AP) | **yes** — `bills` + `billLines`, status workflow |
| Expense tracking | **yes** — `expenses` + `expenseSplits` + receipt OCR (Anthropic) + Blob attachments |
| Recurring invoices | **yes** — `recurringInvoices` + nightly cron |
| Recurring expenses | **yes** — `recurringExpenses` + nightly cron |
| Bank accounts + transactions | **yes** — `bankAccounts`, `transactions`, plus statement parsers for Raiffeisen, BKT, Payoneer (CSV+PDF) |
| Bank reconciliation | **partial** — match tracking exists (`matchStatus`, `matchConfidence`, AI fallback), no formal "reconciled period" table |
| Payment recording (against invoices/bills) | **yes for AR** (`payments` → invoices); **no for AP** (bills don't have a payments-applied table — paid via direct expense or status flip) |
| Customer master | **yes** — `clients` |
| Vendor master | **yes** — `vendors` |
| Items/products catalog | **yes** — `items` |
| Sales tax handling | **yes** — `taxRates` catalog + per-line `taxRate/taxAmount` + `taxTreatment` (domestic/reverse_charge/export) + VAT report |
| Multi-currency | **yes** — EUR + USD enum only; `exchangeRate` + `fxRateToBase` on invoices/expenses/payments |
| Reports (P&L / BS / CF / AR aging / AP aging / GL) | **partial** — P&L yes, AR aging yes, VAT yes, **no balance sheet**, **no cash-flow statement** (dashboard chart only), **no AP aging report**, **no general ledger** |
| Document upload / receipts | **yes** — Vercel Blob + magic-byte validation + OCR |
| Audit trail | **yes** — `auditLog` with before/after JSON |
| Soft delete | **yes** — 12 tables, `deletedAt`, `notDeleted()` helper |
| Estimates / quotes | **yes** + accept/decline + convert-to-invoice |
| Credit notes | **yes** |
| Projects + time tracking | **yes** |
| Fixed assets + depreciation | **yes** — 4 methods, monthly cron |
| Webhooks | **yes** — outbound, HMAC-signed |
| Client portal | **yes** (Phase 2 already shipped) — `/portal/*` separate layout |
| 1099/W-9 / year-end | **no** — US tax forms not modeled (PBA is Kosovo-based) |
| 2FA / security | **yes** — TOTP + backup codes + remember-device tokens + lockout |

---

## 4. Schema overlap with Pipeline AI

Pipeline AI tables (verified in `001_initial_schema.sql`, 002–014): `organizations, users, clients, sites, service_catalog, client_pricing_overrides, jobs, job_line_items, invoices, bank_transactions, activity_log, crews, crew_members, recurring_job_schedules, proposals, proposal_line_items, proposal_signatures, equipment_categories, equipment_qr_batches, equipment_qr_codes, equipment, equipment_scans, equipment_jobs, equipment_inspections, equipment_service_requests`. Stripe fields are columns on `organizations` + `invoices` (no `payments` or `stripe_*` tables).

**`clients`** — PL: `organization_id`, `company_name notnull`, `client_type` enum (property_mgmt/landlord/commercial/residential/contractor), insurance fields, `payment_terms` *enum* (on_receipt/net_15/net_30/net_60/custom). PBA: `displayName notnull`, `currency`, `paymentTermsDays` *int* + free-text label, `taxTreatment`, `defaultDepositAccountId`, `portalUserId`, `language`. Merge-able into a superset table at the cost of ~10 nullable cols both sides + type translation on `payment_terms`.

**`invoices`** — **NOT merge-able cleanly.**
- PL: `job_id notnull` (every invoice ties to a job — no jobless invoices possible), `UNIQUE(organization_id, invoice_number)`, no `currency` (USD-assumed), no line-items table (line items live on parent `job_line_items`), status enum (draft/sent/paid/partially_paid/overdue/void), Stripe payment_intent/checkout_session/payment_link columns.
- PBA: `invoiceNumber` globally unique, `currency + exchangeRate + fxRateToBase`, separate `invoiceLines`, status enum (draft/sent/viewed/partial/paid/overdue/cancelled/written_off), reminders, isLocked, language, attachmentUrls, purchaseOrder.
- Field-by-field: status enums overlap but mismatch (`partially_paid` vs `partial`; PL `void` vs PBA `cancelled`+`written_off`); `invoice_number` uniqueness scope is different (org-scoped vs global); line-item shape is incompatible. A job-rooted simple invoice and an accounting-grade invoice cannot live in one row.

**`users`** — type-level incompatibility: PL `users.id uuid REFERENCES auth.users(id)` (Supabase) vs PBA `users.id text PK` (Auth.js self-generated). FK plumbing must be rewritten to merge.

**`organizations`** — does not exist in PBA. Adding it is §5.

**Payments** — PL has no `payments` table (paid_amount/paid_date/payment_method are columns on `invoices` itself). PBA's `payments` is a first-class payment ledger. PL's `bank_transactions` is a rudimentary import staging table; PBA's `transactions` is far richer (statement linkage, category enum, AI matching, value date).

**`activity_log`** (PL) vs `auditLog` (PBA) — same idea, different schema; merge-able.

---

## 5. Multi-tenancy model in PBAccounting

**Answer: (a) — single-tenant per install.** Strong evidence:

- No `organization_id` (or any `tenant_id` equivalent) on any table in `src/db/schema.ts` — 40+ tables, zero tenancy columns.
- `settings` is a singleton (`id integer PK default 1`, line 278) hard-coded to "Polar Bear Agency LLC".
- Auth whitelist in `src/auth.ts`: `ALLOWED_OWNER_EMAILS = (process.env.OWNER_EMAILS || "diell@polarbearagency.com").split(",")`. Anyone whose email matches a `clients.email` row gets `role='client'` for portal access. Everyone else is rejected.
- `CLAUDE.md` line 9: "custom invoicing + AR + purchases app **for Polar Bear Agency**".
- Vercel Blob store is hardcoded (`store_N9MpZaXwtHv0FNU0`) — no per-tenant bucketing.
- Single Neon project, no schema separation.

**Cost to convert to (c) — multi-tenant multi-org:** add `organization_id` to ~30 tables + backfill; rescope every global `unique` (invoice_number, estimate_number, credit_note_number, bill_number, account_code, client/vendor email) to `UNIQUE(organization_id, …)`; replace `settings` singleton with per-org; rewrite every Drizzle query in `src/lib/actions/**` (~40 modules) to add `eq(table.organizationId, currentOrgId)` (no RLS defense in depth — must be perfect); rebuild `auth.ts` session to carry `organizationId`; per-tenant Blob path prefixing; per-tenant cron fan-out. **Estimated 11–17 agent-days. This is the dominant integration cost.**

---

## 6. Auth model

PBA uses **Auth.js v5 (NextAuth beta 25)** + Drizzle adapter (`src/auth.ts`): Resend magic-link + owner username/password (Audit 18) + TOTP 2FA with backup codes and remember-device tokens. Pipeline AI uses Supabase Auth (password / OAuth, cookie+JWT, no 2FA). User IDs incompatible (Supabase uuid vs Auth.js text). For shared identity, one must be authoritative — bridging via token exchange is doable but adds a security surface.

---

## 7. UI design language

Pipeline AI: Tailwind v4 + shadcn/ui + Lucide + `motion` + `base-ui/react` + `vaul` + `next-themes` (dark mode) + per-tenant `BrandProvider`. PDFs via jsPDF, 4 themes. PWA installable.

PBA: Tailwind v4, **no shadcn** — hand-rolled components, `clsx`/`tailwind-merge`/`lucide-react`. Brand tokens `--pba-navy #05093d / --pba-green #00ff85 / --pba-blue #0d06ff / --pba-steel #98b9ce`; fonts Outfit + DM Mono. PDFs via `@react-pdf/renderer`. PWA scaffolding present (`src/app/_pwa`). No dark mode.

They won't feel like the same product without rebuild — different fonts, primitives, brand colors. Every PBA page would need a shadcn retrofit + token swap to match Pipeline AI.

---

## 8. Integration recommendation

**Option 2 — API-to-API integration (keep PBAccounting as a separate service Pipeline AI calls into).** Treat PBAccounting as Polar Bear Agency's internal back-office. Pipeline AI calls it through a small HTTP API for the books-related actions the field-service app actually needs.

**Why.** Schema mismatch on `invoices` and absence of multi-tenancy in PBA make Option 3 a multi-month port. Pipeline AI tenants (Bogdan / NYSD) need field-service invoicing they already have, not a full accounting suite. PBA is an audited single-tenant tool — forcing multi-tenancy breaks every query and burns the auditing work. Option 1 (iframe) doesn't share data; Option 4 (file merge) is Option 3 with worse hygiene.

**Top 5 concrete pieces of work**
1. **Define the shared resource set:** `Customer`, `Invoice`, `Payment`. Pipeline AI pushes a created/updated invoice (with line items, currency, totals) into PBAccounting on job-invoice and on payment.
2. **Inbound webhook layer in PBA.** Add `src/app/api/external/pipeline/{invoice,payment,client}/route.ts` with HMAC verification — reuse the existing `webhooks` HMAC code in `src/lib/webhooks/`.
3. **Client/invoice mapping table in PBA.** New `external_links (provider text, entity text, external_id text, internal_id uuid, PRIMARY KEY (provider, entity, external_id))`.
4. **Outbound integration module in Pipeline AI** at `src/lib/integrations/pbaccounting/` (fetch + zod), env-gated by `PBACCOUNTING_BASE_URL` + `PBACCOUNTING_HMAC_SECRET`. Hook into invoice-create / invoice-paid paths.
5. **Per-org opt-in flag** on `organizations` (e.g. `pbaccounting_enabled boolean`), not a tier feature — initially only PBA's own org `a0000000-0000-0000-0000-000000000001`.

**Risks.** Drift on post-sync edits (need lock-on-send or idempotent re-push); currency mismatch (PL USD-only, PBA EUR/USD — must capture FX on push); first-time client matching (PL `company_name` ≠ PBA `displayName`); webhook ordering (paid-before-sent must be tolerated); **PBA's single-tenancy is a hard ceiling** — one Pipeline AI org max.

**Effort.** ~8–12 agent-days (3 PBA webhooks, 3 Pipeline AI client+hooks, 2 mapping/UI, 2–4 QA). For comparison: Option 3 = 40–60 agent-days (tenancy conversion ~15, Drizzle→Supabase rewrite ~10, auth bridge ~5, storage ~3, UI retrofit ~10).

---

## 9. Must-answer before any code is written

These need Diell's call. Most are framed around whether PBAccounting is for PBA only, or whether it eventually serves Pipeline AI tenants:

1. **Is PBAccounting only ever for Polar Bear Agency, or also a feature offered to Pipeline AI customers?** Drives the entire integration shape. If PBA-only → Option 2 is enough. If tenant-facing → §5 work is unavoidable.
2. **Single source of truth for `clients`** — Pipeline AI's `clients` table, PBA's `clients`, or maintain both with sync? (Likely separate; sync via an `external_client_links` table.)
3. **Single source of truth for `invoices`** — same question. PBA's invoice model has nine fields Pipeline AI's lacks (currency, exchange_rate, balance, isLocked, language, attachmentUrls, reminderLevelsSent, fxRateToBase, depositAccountId).
4. **What happens to Pipeline AI's existing `invoices` table?** Stays as-is (Option 2)? Replaced (Option 3)? Wrapped to dual-write?
5. **Does Pipeline AI need true double-entry accounting?** Neither codebase has a `journal_entries` / GL table today — both use single-sided posting computed from the source documents. If yes, this is net-new work in either codebase.
6. **Auth: one identity provider or two?** If users should single-sign-on between Pipeline AI and PBAccounting, Supabase Auth must front everything (and PBA gets a Supabase-Auth retrofit), or NextAuth becomes the identity layer (and Pipeline AI gets retrofitted off Supabase Auth).
7. **New `bookkeeper` / `accountant` role?** Pipeline AI's role enum is currently `super_admin | owner | office_manager | field_tech | client` (verified at `001_initial_schema.sql:46` — the prompt's "dispatcher / tech_lead" roles don't exist in code yet). Books access needs a defined role.
8. **Which tier(s) get books access?** Currently `tier-limits.ts` has no `books`/`accounting` feature flag. Add `bookkeeping: boolean` to `TierConfig['features']` — Business-only? Professional+? Add-on?
9. **Currency policy.** Pipeline AI is USD-only; PBA is EUR/USD; real multi-tenant SaaS will want all currencies. Decide whether to extend PBA's `currency` enum or move to ISO-4217 text now.
10. **Data residency.** Pipeline AI's Supabase is presumably US-region; PBA Neon is `eu-central-1` (Frankfurt, GDPR-friendly). If books data is consolidated, where does it live?
11. **Stripe Connect → PBAccounting payments.** When a Pipeline AI invoice gets paid via Stripe, who creates the matching PBA `payment` row, and against which `bankAccount` does it deposit? Needs a configured `defaultStripeDepositAccountId`.
12. **Soft-delete contract.** PBA deletes are reversible (`deletedAt` + `/trash` page). Pipeline AI has partial soft-delete on `jobs`, `clients`, `sites`, `invoices` (migration 007). Cross-system deletes need a contract.

---

**Bottom line.** PBAccounting is a well-engineered, deeply-audited single-tenant accounting tool, with a very different stack (Drizzle/Neon/NextAuth/Blob) from Pipeline AI (Supabase end-to-end). It is much closer in features to Zoho Books than Pipeline AI is to an accounting product. Don't merge codebases. Treat PBAccounting as PBA's internal books, hook it to Pipeline AI via a small signed HTTP/webhook bridge, and only revisit a deeper integration if Pipeline AI tenants ever ask for full bookkeeping inside the SaaS — at which point the right move is probably "build a Pipeline AI `/books` module from scratch on Supabase + raw queries", not "port PBA's code".
