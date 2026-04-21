@AGENTS.md

# Pipeline AI — project memory

Read this at the start of every session in this repo. It captures the decisions, rules, and gotchas that an audit of prior sessions showed we keep re-learning.

## What this is

**Pipeline AI** is the internal webapp for **NYSD** (New York Service Dispatch) — a plumbing/services company operated by Bogdan. Field technicians submit reports from the field, office staff review and turn them into invoices, clients get PDFs by email. Claude (Anthropic SDK) is used to auto-draft the invoice language from the tech's field notes.

- **Live:** https://pipeline-ai-beige.vercel.app
- **Owner:** Diell (super_admin) · Bogdan (owner of NYSD org)
- **Stack:** Next.js 16.2.3 · React 19 · TS · Supabase (Postgres + Auth + RLS) · Tailwind 4 · shadcn/ui · Anthropic SDK · Resend · jsPDF
- **Hosting:** Vercel (primary, matches Supabase `us-east-1`)
- **Supabase project:** `pipeline-ai` (North Virginia)

## Hard rules

1. **RLS is load-bearing.** Every user-scoped query must pass through Supabase RLS with the user's JWT. Never use the service-role key from a user-facing route. The `setup-test-users` endpoint that burned us (CRITICAL finding, unauthenticated service-role use) is deleted — do not recreate that pattern.
2. **Organization isolation.** Every `jobs`, `invoices`, `clients`, `sites`, and `job_line_items` query must be scoped to `organization_id`. There is one org right now (NYSD), but the schema is multi-tenant by design.
3. **AI output is untrusted input.** Anything coming back from the Anthropic call goes through HTML escaping before it lands in an email template or PDF. Field techs' notes also get sanitized before being fed to the prompt — prompt-injection defense.
4. **Password generation must use `crypto.getRandomValues()`** — never `Math.random()`. This was a fixed finding.
5. **Roles:** `super_admin` (Diell), `owner` (Bogdan), `office_manager`, `field_technician`, `client`. Keep permission checks in the sidebar/nav in sync with RLS — we've shipped bugs twice where the nav hid a page the role could actually access.

## Architecture at a glance

```
src/
  app/
    (auth)/       — login, signup, reset
    (dashboard)/  — main app, org-scoped routes
    api/          — route handlers, all auth-gated
  middleware.ts   — checks app_metadata.organization_id on JWT
  lib/
    supabase/     — server + browser clients
    ai/           — Anthropic calls, prompt templates
  components/     — shadcn/ui + custom
supabase/
  migrations/     — source of truth for schema + RLS
```

Onboarding flow sets `app_metadata.organization_id` on the Supabase user — middleware and layout both check it. If you change where that value is read, change it in **both** places (middleware + `(dashboard)/layout.tsx`) or you'll create a redirect ping-pong.

## Decisions log

- **2026-04-11** — Logic audit (17 findings, all critical + important items fixed). Added job statuses `completed` + `cancelled`, `assigned_to` technician field, per-job priority flag, time tracking fields (`scheduled_time`, `arrival_time`, `completion_time`), `tax_rate` on invoices, `credit_card` payment method.
- **2026-04-12** — Security audit (9 findings, all patched). Critical: deleted unauth admin endpoint. High: stripped plaintext password from team-invite response, added HTML escaping to email builder, added tech-note sanitization. Medium: replaced `Math.random()`, added CSP + HSTS.
- **2026-04-21** — Diell is super_admin via `diell@polarbearagency.com`. Bogdan's owner account is `bogdanmay97@gmail.com`. Four test role accounts exist under `bogdanmay97+<role>@gmail.com` — don't delete them, they're how we test role-gated UI.

## Common pitfalls (we've hit these — don't repeat)

- **"Middleware lets me in but layout redirects me to /onboarding."** The middleware checks `app_metadata.organization_id`; the layout used to only check a DB row. Fix = both check `app_metadata` first, then DB fallback. Clear cookies after fixing.
- **`quantity` on `job_line_items` was INTEGER** — hourly billing needs decimals (1.5h). It's `numeric` now. Don't regress the migration.
- **`total_price` on line items is stored, not computed** — documented tradeoff; if you refactor to computed, check the PDF generator doesn't break.
- **Supabase migrations must be applied via MCP** (`mcp__24174e1e-…__apply_migration`). Don't run them through psql from the sandbox; they'll be out of sync with Supabase's migration tracking.

## Quick commands

```bash
npm run dev          # local dev
npm run build        # production build
npm run lint         # eslint
npx vercel --prod    # deploy (usually via git push though)
```

## Last updated

2026-04-21 — rewritten from a single `@AGENTS.md` pointer into a full memory file.
