# Pipeline AI — Audit Log

All changes made during the logic, code, and security audits.
Last updated: 2026-04-11

---

## AUDIT #1: Logic Review (Industry + Business Logic)

### CRITICAL — Breaks things or wrong logic

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| L1 | **Missing job statuses**: No `completed` or `cancelled` status. Once invoice is sent and paid, job stays as `sent` forever. | Critical | Fixed |
| L2 | **Sidebar permission mismatch — Invoices**: Nav shows Invoices only with `invoices:view_all`, but `client` role has `invoices:view_own`. | Critical | Fixed |
| L3 | **Sidebar permission mismatch — Finances**: Nav shows Finances only with `financials:view`, but `office_manager` has `financials:view_limited`. | Critical | Fixed |
| L4 | **No RLS UPDATE policy on organizations**: Owners can't update their org settings (branding, etc.). | Critical | Fixed |
| L5 | **job_line_items RLS too permissive**: Any org member can INSERT/UPDATE/DELETE line items on ANY job. | Critical | Fixed |
| L6 | **quantity on job_line_items is INTEGER**: Hourly billing needs decimal (1.5 hours). | Critical | Fixed |
| L7 | **Basic tier has no approval workflow but status flow requires it**: No auto-advance logic. | Important | Documented (Phase 2) |

### IMPORTANT — Missing industry features

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| L8 | **No technician assignment on jobs**: Only `submitted_by` exists. No `assigned_to` field. | Important | Fixed |
| L9 | **No emergency/priority flag on jobs**: Plumbing emergencies need per-job priority. | Important | Fixed |
| L10 | **No time tracking on jobs**: No `scheduled_time`, `arrival_time`, `completion_time`. | Important | Fixed |
| L11 | **Missing `credit_card` payment method**: Very common, was missing. | Important | Fixed |
| L12 | **Office manager can't mark invoices as paid**: Permission missing. | Important | Fixed |
| L13 | **No tax_rate on invoices**: NYC has specific tax rules. | Important | Fixed |
| L14 | **No estimate/quote data model**: Feature flag exists but no DB table. | Important | Documented (Phase 2) |

### MINOR

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| L15 | **Redundant RLS SELECT on sites**: FOR ALL + FOR SELECT double paths. | Minor | Fixed |
| L16 | **total_price on job_line_items stored instead of computed**. | Minor | Documented |
| L17 | **No soft delete on jobs**: Clients/sites have `deleted_at` but jobs don't. | Minor | Fixed |
| L18 | **Theme cleanup missing sidebar CSS vars**: Only 5 of 12 cleaned up. | Minor | Fixed |

### Files Changed
- `src/types/database.ts` — Added JobPriority, completed/cancelled status, credit_card, assigned_to, priority, time fields, tax_rate, deleted_at
- `src/lib/permissions.ts` — Added `invoices:mark_paid` to office_manager
- `src/components/layout/app-sidebar.tsx` — Added `anyPermission` support for Invoices/Finances nav items
- `src/hooks/use-theme-brand.ts` — Clean up all 12 CSS custom properties
- `supabase/migrations/001_initial_schema.sql` — All DB schema fixes (new columns, CHECK constraints, RLS policies, indexes)

---

## AUDIT #2: Second Pass

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| A2-1 | **Hardcoded tier labels in header**: Should use `getTierConfig().label` instead of ternary chain. | Medium | Fixed |
| A2-2 | **Missing error handling in sign-out**: No try-catch, toast fires before confirming success. | Medium | Fixed |
| A2-3 | **Missing error handling in providers.tsx**: Supabase queries ignore error objects. | Medium | Fixed |
| A2-4 | **Empty next.config.ts**: No production security headers, no image optimization config. | Medium | Fixed |
| A2-5 | **Duplicate import in app-sidebar.tsx**: `hasPermission` imported on two lines. | Low | Fixed |
| A2-6 | **ESLint: unused `theme` variable in app-sidebar.tsx**. | Low | Fixed |
| A2-7 | **ESLint: `<img>` should be Next.js `<Image>`** in sidebar logo. | Low | Fixed |

### Files Changed
- `src/components/layout/app-header.tsx` — Use `getTierConfig()`, add error handling to sign-out
- `src/components/providers.tsx` — Add error destructuring and try-catch to session loading
- `next.config.ts` — Add security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) + Supabase image optimization
- `src/components/layout/app-sidebar.tsx` — Fix duplicate import, remove unused variable, use `<Image>`

---

## Security Audit

See full report: `SECURITY-AUDIT.md`

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| S1 | **User self-escalation via RLS gap**: Any user can `UPDATE users SET role = 'super_admin'` on themselves. RLS is row-level only. | CRITICAL | Fixed (trigger) |
| S2 | **Organization tier tampering**: Owner can `UPDATE organizations SET tier = 'business'` without paying. | CRITICAL | Fixed (trigger) |
| S3 | **Organization billing field manipulation**: Owner can modify stripe IDs and limits. | CRITICAL | Fixed (trigger) |
| S4 | **Missing rate limiting on login**: Brute force vulnerability. | HIGH | Documented (Phase 2) |
| S5 | **Missing Content-Security-Policy header**. | MEDIUM | Documented (Phase 2) |
| S6 | **Env var non-null assertions**: Crash without useful error if env vars missing. | MEDIUM | Fixed |
| S7 | **Predictable seed UUIDs**: Development only, acceptable. | LOW | Documented |
| S8 | **Dead link to /forgot-password**: Page doesn't exist yet. | LOW | Documented |

### Files Changed
- `supabase/migrations/001_initial_schema.sql` — Added `prevent_user_self_escalation()` trigger + `protect_org_billing_fields()` trigger
- `src/lib/supabase/client.ts` — Env var validation with clear error messages
- `src/lib/supabase/server.ts` — Env var validation with clear error messages
- `src/lib/supabase/middleware.ts` — Env var validation + extracted PUBLIC_ROUTES constant

---

## Final Deep Code Audit

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| D1 | **Unsafe property access in sidebar Image alt**: `organization.name` without optional chaining inside conditional. | Medium | Fixed |
| D2 | **getTierConfig returns undefined on invalid tier**: No fallback if tier value is unexpected. | Medium | Fixed |
| D3 | **Unused exports**: `getPermissions`, `canManageRole`, `hasAllPermissions`, `hasFeature`, `canGenerateAI`, `canAddUser`. | Info | Kept (needed for future phases) |

### Files Changed
- `src/components/layout/app-sidebar.tsx` — Added optional chaining with fallback on Image alt
- `src/lib/tier-limits.ts` — Added fallback `|| TIER_CONFIGS.basic` in getTierConfig

---

## Summary of All Audits

**Total findings**: 29
**Fixed**: 22
**Documented for Phase 2**: 7

**Build status**: Clean (0 errors, 0 ESLint warnings)
**npm audit**: 0 vulnerabilities
**Dependencies**: All at latest versions within semver ranges
