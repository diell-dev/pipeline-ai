# Pipeline AI

Multi-tenant SaaS for field-service businesses (plumbing, drain cleaning, HVAC,
electrical). A field tech captures job data + photos, the app generates a
service report and invoice, a manager approves, and the system emails the
client with a card-payment link. Adjacent modules: proposals/estimates with
e-signature, scheduling with crews + a daily recurring-jobs cron, QR-based
HVAC equipment cataloging, and a double-entry bookkeeping module ("Books").

First customer: **New York Sewer & Drain**. Built by **Polar Bear Agency**.

## Stack

- **Next.js 16** (App Router, Turbopack) · **TypeScript** (strict)
- **Supabase** Postgres + Auth + Storage, **RLS on every table**
- **Tailwind v4** + **shadcn/ui** · **Zustand** for auth state
- **Anthropic SDK** (reports / equipment AI) · **Resend** (email)
- **Stripe Connect** (per-org payments) · **jsPDF** (invoices/reports)
- **Vercel** (hosting + daily cron)

## Local setup

```bash
cp .env.example .env.local   # fill in Supabase / Anthropic / Resend / Stripe
npm install
npm run dev                  # http://localhost:3000
```

Type-check and lint before pushing:

```bash
npx tsc --noEmit --skipLibCheck
npx eslint
```

## Database

Migrations live in `supabase/migrations/` and are applied in order. Apply new
ones via the Supabase SQL editor or MCP. RLS is the primary tenant-isolation
boundary; API routes add defense-in-depth org/role checks on top.

## Docs

`CLAUDE.md` is the canonical engineering reference (architecture, roles, tiers,
branding, common pitfalls). Read it before making changes.
