@AGENTS.md

# Pipeline AI — Project Instructions

> **For Claude sessions and developers joining the project.** This file is the canonical reference. Read it before making any change. When you ship something new, update the relevant section here.

---

## 1. What this is

Pipeline AI is a multi-tenant SaaS for field service businesses (plumbing, drain cleaning, HVAC, electrical, concrete). The first paying customer is **New York Sewer & Drain (NYSD)**; the platform is being built to onboard many more.

**The flow it automates:**
1. Field tech visits a site, gathers data + photos.
2. Tech (or office) creates a job in the app.
3. AI generates a service report + invoice from the job data.
4. A manager reviews + approves.
5. System emails report + invoice to the client.
6. Client can pay by check / wire / ACH / Stripe card link.

**Adjacent flows:**
- **Proposals / estimates** — first-visit workflow with admin approval, client e-signature, auto-conversion to a job once signed.
- **Scheduling** — calendar with day/week/month views, crews, recurring patterns + a daily cron that auto-spawns jobs from those patterns.
- **HVAC Equipment cataloging** — QR-code-based asset tracking; tenants can scan a sticker to request service without an account.

**Partnership:** Built by Polar Bear Agency (PBA). Bogdan May (NYSD owner) and Diell Grazhdani (PBA) agreed on **2026-05-19** to a formal partnership to bring Pipeline AI to the trades-SaaS market. Bogdan provides domain expertise + first customers, Diell provides product + tech.

---

## 2. URLs and IDs (memorise / bookmark)

| Resource | Value |
|---|---|
| **Production** | https://pipeline-ai-beige.vercel.app |
| **GitHub** | https://github.com/diell-dev/pipeline-ai (public, `main` branch) |
| **Vercel project ID** | `prj_rYfYg9NUtg30wmI67vXyoORE73fR` |
| **Vercel team ID** | `team_kdFejt1F9Y89hIwdibapaofC` (`diell-devs-projects`) |
| **Supabase project** | `zabfuqxjjunsppotfrel` (us-east-1, Free tier) |
| **Supabase URL** | `https://zabfuqxjjunsppotfrel.supabase.co` |
| **Local repo path (Mac)** | `/Users/diellgrazhdani/Documents/Claude/Projects/NYSD - APP/pipeline-ai` |

**Reset / emergency credentials:** Diell super_admin → `diell@polarbearagency.com` / password reset via Supabase admin SQL when needed (see Common Pitfalls §10).

**Pre-seeded orgs:**
- **Pipeline AI** — Diell's org; super_admin uses it.
- **New York Sewer & Drain** — Bogdan's org (owner); contains real test data (11 jobs, 12 invoices as of 2026-05-22).

---

## 3. Tech stack (frozen choices)

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | Don't ever introduce pages router |
| Language | **TypeScript** strict | `tsc --noEmit --skipLibCheck` must always pass |
| Styling | **Tailwind v4** + **shadcn/ui v4** | Components in `src/components/ui/*` are shadcn primitives — don't fork them |
| DB | **Supabase Postgres** (Free tier, will need Pro for prod) | RLS enabled on every table |
| Auth | `@supabase/ssr` | Cookie-based; never use the deprecated `auth-helpers-nextjs` |
| State | **Zustand** (`useAuthStore`) | Server state via fetch; no React Query yet |
| AI | **Anthropic SDK** (`@anthropic-ai/sdk`) | Model `claude-sonnet-4-6` everywhere |
| Email | **Resend** | Optional; `RESEND_API_KEY` env var |
| Payments (to contractors) | **Stripe Connect (Express)** | Each org connects their own account |
| PDF | **jspdf** + **jspdf-autotable** | Invoice PDFs in 4 themes |
| QR | **qrcode** (server, batch PDFs) + **jsqr** (client, scanner) | Don't switch — jsqr works on iOS where BarcodeDetector doesn't |
| Cron | **Vercel Cron** | Defined in `vercel.json`; daily 06:00 UTC |
| Deployment | **Vercel** | Hobby tier; auto-deploy from `main` |
| Monitoring | None yet | Sentry / PostHog on the SAAS roadmap |

**Don't install new packages without good reason.** Check existing utilities first.

---

## 4. Architecture

### 4.1 Multi-tenancy
**Organization** is the root entity. Every domain table has `organization_id`. Tenant isolation is enforced by Postgres RLS — not by application code as the primary defence (the app does add belt-and-suspenders checks but RLS is the floor).

### 4.2 Roles
Defined in `src/types/database.ts` as `UserRole`:

| Role | What they do |
|---|---|
| `super_admin` | Platform-level (Diell). Can read/write across all orgs. Used for support. |
| `owner` | Org owner (e.g. Bogdan). All permissions inside their org including delete + billing. |
| `office_manager` | Approves jobs/proposals, manages clients/sites/team, sees finances. No delete. |
| `field_tech` | Submits jobs + proposals, sees their own work. |
| `client` | Read-only portal access (not built yet; permissions array is empty). |

Permission matrix lives in `src/lib/permissions.ts` (`ROLE_PERMISSIONS`). When adding a new permission key, add it to the `Permission` union AND to each role's array.

### 4.3 Subscription tiers
- **Basic** ($49/mo) — core jobs + invoices + proposals
- **Professional** ($129/mo) — adds dashboard analytics + multi-user
- **Business** ($249/mo) — adds scheduling module, crews, recurring schedules, multi-crew management

Feature gates in `src/lib/tier-limits.ts`. **Currently most tier gates are NOT enforced** in the UI — see SAAS roadmap.

### 4.4 Per-tenant branding (Phase 1 of design overhaul)
Each org has `logo_url`, `primary_color`, `accent_color`, `secondary_color` on the `organizations` row.

The **`BrandProvider`** (`src/components/providers/brand-provider.tsx`) subscribes to `useAuthStore().organization` and injects CSS variables on `:root`:
- `--brand-primary` (hex)
- `--brand-primary-rgb` (RGB triplet for `rgb(var(--x) / <alpha>)`)
- `--brand-primary-fg` (auto-contrasting text colour)
- `--brand-primary-50` through `--brand-primary-900` (tints)
- `--brand-accent` / `--brand-accent-rgb` / `--brand-accent-fg`

**Use the brand utility classes everywhere** instead of hardcoding hexes:
- `bg-brand-primary` / `text-brand-primary` / `border-brand-primary` / `ring-brand-primary`
- `bg-brand-accent` / `text-brand-accent` / `border-brand-accent`
- `<Button variant="brand">` for primary CTAs
- For alpha: `rgb(var(--brand-primary-rgb) / 0.1)` inline

Defaults exist in `globals.css` so server-rendered/auth pages render correctly before the provider mounts. `theme.ts` exposes `tintsFor(hex)`, `getContrastingText(hex)`, `isValidHex(s)`, `toRgbVar(hex)`.

The branding settings page (`src/app/(dashboard)/settings/branding/page.tsx`) lets org admins upload a logo (Supabase Storage `org-logos` bucket) and pick colours, with a live-preview panel that dispatches `brand-preview` events so the rest of the app re-themes without saving.

---

## 5. Database

### 5.1 Migrations
All in `supabase/migrations/`, numbered sequentially. Apply via the Supabase MCP `apply_migration` tool, then save the SQL file to the repo. Don't edit applied migrations; write a new one.

| # | Name | What it adds |
|---|---|---|
| 001 | Initial schema | organizations, users, clients, sites, service_catalog, client_pricing_overrides, jobs, job_line_items, invoices, bank_transactions, activity_log. RLS + helper functions (`get_user_org_id`, `get_user_role`). Update triggers. |
| 002 | Scheduling module | crews, crew_members, recurring_job_schedules. Added `scheduled` status + scheduling columns to jobs. Crew-aware jobs RLS. |
| 003 | Proposals module | proposals, proposal_line_items, proposal_signatures. `jobs.proposal_id` FK back-link. |
| 004 | Stripe Connect | `organizations.stripe_account_id` + status/charges/payouts flags. `invoices.stripe_payment_intent_id` + checkout/payment_link fields. |
| 005 | Audit-fix round 2 | UNIQUE on `organizations.stripe_account_id`. `job_line_items.service_name` (for custom non-catalog services). |
| 006 | Audit-fix round 2 part 2 | Tightened proposals UPDATE RLS (tech can only edit drafts). `activity_log.user_id` made nullable (for webhook/cron system actions). |
| 007 | Super-admin RLS + invoices.deleted_at | `is_super_admin()` helper. Patched all org-scoped policies to allow super_admin. Added missing `invoices.deleted_at` column. |
| 008 | Equipment cataloging | equipment_categories (15 seeded HVAC types), equipment, equipment_qr_batches, equipment_qr_codes, equipment_scans, equipment_jobs, equipment_inspections, equipment_service_requests. Storage buckets `equipment-photos` + `qr-batches`. |
| 009 | equipment_qr_codes RLS fix | INSERT + DELETE policies missing — batch generation was failing with 'new row violates RLS'. |

### 5.2 RLS rules (the platform's security floor)
- Every domain table has RLS enabled.
- Policies scope by `organization_id = public.get_user_org_id()` OR `public.is_super_admin()`.
- Helper functions `public.get_user_org_id()`, `public.get_user_role()`, `public.is_super_admin()` are SECURITY DEFINER — they read from `users` without recursion.
- The migrations apply to the **service_role** during migration runs; the **anon** + **authenticated** roles obey RLS.

### 5.3 Types
`src/types/database.ts` is the canonical TypeScript shape. When the schema changes, this file MUST be updated in the same commit. Includes: enums, all entity interfaces, the `ActivityAction` union, the `entity_type` union.

### 5.4 Soft deletes
- `jobs.deleted_at`, `invoices.deleted_at`, `clients.deleted_at`, `sites.deleted_at`, `equipment.deleted_at`, `proposals.deleted_at`
- All list queries filter `.is('deleted_at', null)`. Adding a new soft-deletable table? Add the column + the filter.

### 5.5 Audit trail
Every significant action inserts into `activity_log`:
- `organization_id`, `user_id` (nullable for system), `action` (typed `ActivityAction`), `entity_type` (typed), `entity_id`, `metadata` (jsonb).
- **Update `ActivityAction` in `database.ts` when adding new actions.**
- The job detail page renders these as a visual timeline via `src/components/jobs/activity-timeline.tsx`.

---

## 6. Permissions

`src/lib/permissions.ts` is the source of truth. Pattern:

```ts
import { hasPermission } from '@/lib/permissions'
const canApprove = user?.role ? hasPermission(user.role, 'jobs:approve') : false
```

API routes import from `@/lib/api-auth` which re-exports `hasPermission` and adds:
- `getApiUser()` — returns `{ authenticated, userId, organizationId, role }` from the cookie session.
- `canAccessOrg(auth, targetOrgId)` — true if same org OR super_admin. **Use this everywhere an API fetches a row and needs to verify ownership.**

### Permissions currently defined
Jobs, proposals, scheduling, crews, clients, sites, services, pricing, invoices, financials, users, settings, documents, equipment, service_requests. See `Permission` union in the file.

### Equipment module hidden from tenants (as of 2026-05-22)
Currently `equipment:*` and `service_requests:*` permissions are only on `super_admin`. To open to tenants, add them to `owner` / `office_manager` / `field_tech` arrays per the inline comments in `permissions.ts`.

---

## 7. Key patterns (follow these)

### 7.1 Adding a new client-side query
```ts
const { user, organization } = useAuthStore()
const isSuperAdmin = user?.role === 'super_admin'

let q = supabase.from('table').select('*').is('deleted_at', null)
if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
// ...other filters
const { data, error } = await q.limit(50)
```

**Without the `isSuperAdmin` gate, the dashboard appears empty for super_admins** because their nominal org has no data. We hit this exact bug in May 2026.

### 7.2 Adding a new API route
```ts
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'jobs:create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = await createClient()  // cookie-bound — RLS applies
  // ... fetch the row ...
  if (!canAccessOrg(auth, row.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // ... do the work ...
}
```

**Don't use the service-role client for user-facing routes.** Use cookie-bound `createClient` and trust RLS. Service-role is ONLY for:
- `src/app/api/stripe/webhook` (public, Stripe signature verified)
- `src/app/api/proposals/public/[token]/*` (public, token authenticated)
- `src/app/api/public/equipment/qr/[code]/*` (public, rate-limited)
- `src/app/api/internal/cron/*` (CRON_SECRET bearer)
- `src/app/api/jobs/[id]/generate` + `src/app/api/jobs/[id]/send` (long-running AI calls that need to write reliably even if the cookie session expires mid-flight)

### 7.3 Adding a public route (no auth)
- Add the route prefix to `PUBLIC_ROUTES` (page) or `PUBLIC_API_PREFIXES` (api) in `src/lib/supabase/middleware.ts`. Otherwise the middleware redirects to `/login`.
- Rate-limit with `checkRateLimit` from `src/lib/rate-limit.ts` keyed by IP.
- Use `data:image/...;base64,` size guards on any photo/blob uploads.

### 7.4 Email sends (atomic-claim pattern)
Email-then-update was causing duplicate sends from double-clicks. Always:
1. **Claim the row first** with a conditional UPDATE returning the row.
2. If no row returned, return `{ success: true, alreadySent: true }` — not an error.
3. **Then** send the email.
4. If email fails, **revert** the claim (set status back, clear `sent_*_at`).
5. In production, return 500 if `RESEND_API_KEY` is missing instead of silently logging the email.

Reference: `src/app/api/proposals/[id]/send-to-client/route.ts`.

### 7.5 AI calls
- Model name in one place: `MODEL_VISION` + `MODEL_TEXT` in `src/lib/equipment-ai.ts` for equipment OCR + lookup; `model: 'claude-sonnet-4-6'` in `api/jobs/[id]/generate` for report+invoice; `api/test-ai` for the sandbox.
- **Sanitize all user-supplied text before prompt embedding.** See `sanitizeTechNotes()` pattern. Detect known prompt-injection markers (`ignore previous instructions`, `[INST]`, `<<SYS>>`) and log.
- Return `null` on AI failure — don't throw. The caller degrades gracefully.
- Cap output strings + validate dates before persisting.
- Anthropic vision only accepts `jpeg/png/webp/gif`. iPhones often hand back HEIC. The scan flow re-encodes via canvas to JPEG before sending — see `normaliseImageForOcr` in `src/app/(dashboard)/equipment/scan/page.tsx`.

### 7.6 Shared helpers (use these, don't reinvent)
- `src/lib/escape-html.ts` → `escapeHtml(s)` for any user text in HTML emails.
- `src/lib/proposal-totals.ts` → `computeProposalTotals(...)` for proposal math.
- `src/lib/qr.ts` → QR generation helpers.
- `src/lib/equipment-ai.ts` → `extractDataPlate(...)`, `lookupManufacturerInfo(...)`, `computeNextServiceDueDate(...)`.
- `src/lib/rate-limit.ts` → `checkRateLimit(key, { limit, windowMs })` + `getClientIp(request)`.
- `src/lib/format-duration.ts` → human-readable durations for analytics.
- `src/lib/theme.ts` → brand colour helpers.
- `src/lib/stripe.ts` → `getStripeClient()` + `STRIPE_API_VERSION`.
- `src/lib/stripe-helpers.ts` → `createInvoiceCheckoutSession(...)` — pass in a Supabase client (cookie-bound or service-role depending on caller).

### 7.7 New UI components (use these)
- `<EntityCard>` (in `src/components/ui/empty-state.tsx` exists; EntityCard is queued for next pass)
- `<EmptyState>` — `src/components/ui/empty-state.tsx`. Replace bare "no results" text with this.
- `<ClientCombobox>` — `src/components/clients/client-combobox.tsx`. Searchable client picker with inline add-new. Use everywhere instead of `<select>` for clients.
- `<AddClientDialog>` — quick-create dialog from anywhere.
- `<MarkPaidDialog>` — invoice payment recording.
- `<InspectionChecklist>` — for jobs linked to equipment (auto-rendered on job detail page).
- `<EquipmentLifecycleWidget>` — dashboard widget for replacement-cost forecasting.
- `<BottomNav>` — mobile bottom nav at `<md`; rendered alongside the desktop sidebar.

### 7.8 Typography + spacing
**Use the design-token classes**, not ad-hoc Tailwind sizes:
- `text-eyebrow` (small caps section eyebrows)
- `text-body`
- `text-card-title`
- `text-section-header`
- `text-page-title`
- `text-hero`
- `text-kpi-value`
- `text-meta`
- `.nums` (tabular-nums for any column of numbers)

Spacing rhythm (from `globals.css` comments):
```
gap-2 (8px)  → in-card tight (chip rows, icon+label)
gap-3 (12px) → in-card normal (info pairs)
gap-4 (16px) → section internal (label + control)
space-y-4    → siblings inside a card
space-y-6    → cards in a column
gap-6/gap-8  → top-level page sections
```

### 7.9 Status colours
**Use the 5 semantic palettes**, not random per-status hues:
- `status-neutral` `status-info` `status-success` `status-warning` `status-danger`

Job status → palette mapping documented in `globals.css`. Many existing `STATUS_CONFIG` maps haven't been migrated yet; do so incrementally.

### 7.10 Responsive
- Mobile-first. Default styles target `<sm`; use `sm:`, `md:`, `lg:` to scale up.
- Page chrome: `<div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">`.
- Page header: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`.
- KPI grid: `grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4`.
- Info card grid: `grid grid-cols-1 md:grid-cols-2 gap-4`.
- Tap targets: min `h-10` (40px) for buttons, `h-12` for primary mobile CTAs.
- Tables → card lists on mobile via dual-render (`<div className="hidden md:block"><table /></div><div className="md:hidden">{items.map(card)}</div>`).
- Dialogs: `w-[calc(100vw-2rem)] max-w-md sm:max-w-lg`.

---

## 8. Workflows that already exist (don't re-invent)

| Feature | Where it lives | Notes |
|---|---|---|
| Job lifecycle (submit → AI → review → approve → send) | `jobs/*` | Approval banner surfaces pending reviews to managers. |
| Proposals + e-signature | `proposals/*` + `proposals/sign/[token]` (public) | HTML5 canvas signature OR typed name. Audit trail with IP/UA. Auto-converts to a job on signature. |
| Stripe Connect (org-level) | `settings/payments/page.tsx` + `api/stripe/*` + `api/stripe/webhook` | Each org connects their own Express account. Invoice send email includes a Pay-with-Card link when enabled. |
| Mark Paid (manual payments) | `<MarkPaidDialog>` on `invoices` + `finances` pages | Records check#, wire ref, ACH, cash, etc. |
| Calendar (day/week/month) | `schedule/page.tsx` + `schedule/my-schedule` + `schedule/crews` + `schedule/recurring` | Mobile auto-switches to list view. |
| Recurring jobs cron | `api/internal/cron/spawn-recurring-jobs` + `vercel.json` | Daily 06:00 UTC. Auth via `CRON_SECRET`. Idempotent. |
| HVAC Equipment cataloging | `equipment/*` + `api/equipment/*` + `equipment/qr/[code]` (public tenant) | Pre-printed QR rolls. Anthropic vision OCRs the data plate. AI manufacturer lookup enriches. |
| Dashboard analytics | `dashboard/page.tsx` + `api/dashboard/analytics` | Timeframe + client filters. Time-tracking KPIs (proposal→signed, signed→started, started→completed). Default timeframe is `year` so historical data shows by default. |
| Per-tenant branding | `BrandProvider` + `settings/branding/page.tsx` | Live preview, instant re-theme. |

---

## 9. Required env vars (Vercel + local)

| Var | Used by | Required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Everything | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Everything | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Webhook + cron + AI routes | Yes |
| `ANTHROPIC_API_KEY` | AI report + OCR + lookups | Yes (else features no-op) |
| `RESEND_API_KEY` | All outbound email | Required in production (route returns 500 if missing) |
| `STRIPE_SECRET_KEY` | Stripe Connect | Required to enable card payments |
| `STRIPE_WEBHOOK_SECRET` | `api/stripe/webhook` | Required for the webhook |
| `CRON_SECRET` | `api/internal/cron/*` | Required for the daily cron to fire |
| `NEXT_PUBLIC_APP_URL` | Email links + cron output | Defaults to request origin if unset |
| GitHub PAT | Deploy script | Not in env — user provides at push time |

---

## 10. Common pitfalls (we've hit these — don't repeat)

### Supabase Free tier auto-pauses
After ~7 days of no traffic, the Free-tier project pauses. Symptoms: middleware times out, all pages return 504 `MIDDLEWARE_INVOCATION_TIMEOUT`. Restore via the Supabase MCP `restore_project` tool. **Long-term:** upgrade to Pro.

### Diell's local dev `.git` directory has unlink permission issues
The mounted Mac filesystem doesn't allow some delete/unlink operations from the sandbox. Workaround: do git operations in a separate sandbox clone at `/sessions/vibrant-magical-knuth/pipeline-ai-clean`, then push from there.

### Frontend/backend field-name mismatch silently fails
Example: scan page sent `{image_base64}` but `/api/equipment/ocr-data-plate` expected `{photo_base64, mime_type}`. API returned 400; user saw "Couldn't read data plate" forever. **Lesson:** when wiring a new route, write down the contract in a comment + test once end-to-end before assuming.

### iOS Safari + HEIC images
Anthropic vision only accepts jpeg/png/webp/gif. iPhones hand back `image/heic` by default. Always re-encode via canvas before sending. See `normaliseImageForOcr` in `equipment/scan/page.tsx`.

### Vercel Cron only runs on production deployments
Preview branches don't fire scheduled jobs. To test the cron before merging, hit the route directly with the `CRON_SECRET` bearer.

### iOS Safari + Chrome `BarcodeDetector`
Both browsers on iOS use WebKit, which doesn't reliably ship BarcodeDetector. Use jsQR client-side instead. Don't try to feature-detect "is it iOS Chrome" — jsQR works everywhere.

### Hard-cached JS on iOS after deploy
Users complain "the fix isn't live" — usually because iOS Safari served the cached bundle. Tell them: open the URL in a fresh tab (or private/incognito).

### Super_admin sees "0 of everything"
Hardcoded `.eq('organization_id', organization.id)` filters out cross-org data. Pattern: `if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)`. Audit 2026-05-22 found 15 client pages + 6 API routes with this bug — all fixed.

### `service_date` is a plain DATE in browser-local timezone
A job created at 11pm Sunday local will have `service_date = 'Sunday'` but `scheduled_time` UTC may fall on Monday. The schedule list shows one day, the calendar may show another. **Known TODO** — fix involves an `org.timezone` setting + UTC-anchored math. Documented in code TODO blocks.

### Default dashboard timeframe was 'month' → looked broken
New orgs with old data saw "0 this month" and assumed the dashboard was broken. Default is now `year`. Also added a smart "your filter is too narrow, view all time" callout when the current window returns 0 but lifetime > 0.

### Email sends + status updates need atomic claim (see §7.4)
Without it, double-click + slow network = duplicate emails.

### RLS gotcha: new tables need INSERT policies
Equipment QR codes table was created with only SELECT + UPDATE policies (migration 008). Batch generation failed with "row violates RLS" until migration 009 added INSERT + DELETE. **Lesson:** when writing a new table's policies, write all 4 (SELECT, INSERT, UPDATE, DELETE) even if you only think you need 2.

### `git push` from sandbox needs PAT
No stored credentials in the sandbox. User provides a GitHub PAT inline at push time, then revokes it. Never bake the PAT into a script.

### Vercel deployment protection blocks API testing on preview
Preview URLs require SSO. Production is open. To test an API endpoint with a bearer token, hit the production URL (or generate a Vercel bypass token).

---

## 11. Where things are (file map)

```
src/
  app/
    (auth)/                 # Public — login, signup (todo), forgot-password, reset-password
    (dashboard)/            # All authenticated pages — wrapped in BrandProvider + sidebar + bottom-nav
      dashboard/            # Main analytics dashboard
      jobs/                 # List + detail + new
      proposals/            # List + detail + edit + new (admin) — sign page is separate (below)
      schedule/             # Calendar + my-schedule + crews + recurring
      equipment/            # List + detail + scan + qr-batches
      clients/              # CRM
      services/             # Service catalog
      invoices/             # Invoice management
      finances/             # Financials dashboard
      team/                 # User management + invites
      settings/             # Hub + branding / company-profile / email / notifications /
                            #   organization / payments / profile / security
      test-ai/              # AI sandbox (super_admin only)
    proposals/sign/[token]/ # PUBLIC client-facing e-sign page
    equipment/qr/[code]/    # PUBLIC tenant scan-and-request-service page
    api/
      crews/, crew-members/
      dashboard/analytics/, dashboard/equipment-lifecycle/
      equipment/                   # categories, qr-batches, by-qr, register, ocr-data-plate,
                                   #   [id], [id]/ai-lookup
      equipment/public/            # public tenant qr lookup + request-service
      internal/cron/spawn-recurring-jobs/
      invoices/[id]/delete, [id]/mark-paid
      jobs/[id]/                   # delete, generate, reschedule, schedule, send,
                                   #   inspections, start-from-equipment
      proposals/                   # list + [id] + workflow transitions
      proposals/public/[token]/    # GET + sign + reject (public, rate-limited)
      recurring-schedules/
      schedule/                    # GET calendar range
      stripe/                      # connect (start/refresh-status/disconnect), checkout/create,
                                   #   webhook
      team/invite/
      test-ai/
  components/
    clients/             # ClientCombobox, AddClientDialog
    equipment/           # InspectionChecklist, EquipmentLifecycleWidget
    invoices/            # MarkPaidDialog
    jobs/                # ActivityTimeline, etc.
    layout/              # AppSidebar, AppHeader, BottomNav
    providers/           # BrandProvider
    proposals/           # ProposalForm (shared by new + edit)
    ui/                  # shadcn primitives + EmptyState + Button (with brand variant)
  lib/
    supabase/            # client (browser), server (cookie-bound), middleware, service
    pdf/                 # generate-invoice, generate-report, download
    api-auth.ts          # getApiUser, canAccessOrg, hasPermission re-export
    permissions.ts       # ROLE_PERMISSIONS, hasPermission, getRoleLabel, canManageRole
    tier-limits.ts       # TierConfig, hasFeature
    theme.ts             # tintsFor, getContrastingText, isValidHex, toRgbVar
    equipment-ai.ts      # extractDataPlate, lookupManufacturerInfo, computeNextServiceDueDate
    proposal-totals.ts   # computeProposalTotals
    escape-html.ts       # escapeHtml
    rate-limit.ts        # checkRateLimit, getClientIp
    format-duration.ts   # human-readable durations
    stripe.ts            # getStripeClient, STRIPE_API_VERSION
    stripe-helpers.ts    # createInvoiceCheckoutSession
    qr.ts                # QR encoding helpers
  stores/
    auth-store.ts        # useAuthStore — user + organization + refreshOrganization
  types/
    database.ts          # source of truth for DB types + enums + ActivityAction + entity_type
supabase/migrations/     # 001 .. 009 (all applied to production)
vercel.json              # Cron definitions
```

---

## 12. Manual test workflows (we don't have unit tests yet)

After any non-trivial change, walk through:

1. **Login + dashboard** — Bogdan and Diell both see correct numbers.
2. **Create a job → AI generate → approve → send** — full happy path.
3. **Create a proposal → submit-for-approval → admin-approve → send-to-client → public sign page → convert-to-job** — full happy path.
4. **Equipment scan (mobile)** — scan QR → register → equipment detail → start-work-order. Use the OCR happy path.
5. **Mark an invoice paid** — modal opens, all payment methods work.
6. **Stripe Connect** — if env vars set, settings/payments shows status correctly.

---

## 13. Known deferred / queued work

Tracked in detail in the project's task list. Categories:

**Design overhaul Phase 2 (remaining):**
- Tablet icon-rail sidebar (md→lg width: 64px icons only)
- Desktop sidebar zinc-900 softening
- Status colour map migration to semantic classes across all STATUS_CONFIG records
- EntityCard pattern + replace ad-hoc cards in lists
- Dashboard "Today" hero card
- Mobile calendar week-strip + day-detail
- Form sticky-bottom CTAs on mobile

**Bugs / hygiene:**
- Timezone fix for `service_date` vs `scheduled_time`
- `.limit()` on a few unbounded queries (counts + finances stats)
- Replace `window.confirm` with shadcn Dialog
- Standardise empty states (some pages still have bare text)
- Stripe webhook should differentiate Connect vs platform `account.updated` events more carefully

**SAAS readiness (see §15):**
- Self-serve signup + onboarding wizard
- Stripe Billing (subscription, not Connect — that's already done)
- Marketing site + ToS + Privacy
- Tier enforcement everywhere
- PWA + push notifications
- Email digest
- Real client portal
- QuickBooks integration

---

## 14. Partnership / business context

- **2026-04-30**: Bogdan delivered "feedback round 2" via WhatsApp (proposals, calendar, Stripe, Mark Paid, dashboard analytics). All shipped 2026-04-30 to 2026-05-13.
- **2026-05-19**: Bogdan + Diell agreed to formal partnership; contract drafting in progress.
- **Equipment cataloging gated to super_admin (2026-05-22)** — Diell wanted to iterate before showing Bogdan. To open up, re-add `equipment:*` + `service_requests:*` to owner/office_manager/field_tech in `permissions.ts`.
- **Insurance / industry context:** Bogdan's HVAC team going live with insurance soon — that's why HVAC equipment was the urgent module.

---

## 15. SAAS readiness roadmap (next phase)

Built-but-not-marketable today. To become a sellable SaaS:

**Month 1 — make it sellable**
1. Self-serve signup → org creation → onboarding wizard
2. Stripe Billing (subscription products: Starter $49 / Pro $129 / Business $249)
3. Marketing landing page + ToS/Privacy + booking flow
4. Tier enforcement (max users, max AI generations, feature gates surface as "Upgrade to unlock")
5. Onboarding checklist on dashboard + sample data option

**Month 2 — make it sticky**
6. Email digest (daily owner summary + per-event push)
7. PWA + push notifications
8. Activity feed UIs (per-client, org-wide)
9. Reports + exports (PDF + CSV)

**Month 3 — make it grow**
10. QuickBooks integration (single biggest sales lever for trades SaaS)
11. Real client portal (`client` role)
12. 2FA + magic-link sign-in

**Month 4+ — differentiate / premium tiers**
13. White-label tier (use existing branding foundation as the basis)
14. AI predictive features (equipment failure forecasting, pricing recommender)
15. Embedded fintech (Stripe Issuing for crew expense cards, factoring)

Full plan with rationale was delivered to Diell on 2026-05-22 in the chat session — search for "SaaS roadmap" in conversation history.

---

## 16. Working with this project

### When starting a new session, **read this file first**, then check:
- The most recent commits (`git log --oneline -20`) for context on what just changed
- The auto-memory file at `/sessions/<session>/mnt/.auto-memory/project_nysd_app.md` if it exists

### When making changes:
1. **Type-check** after every meaningful edit: `npx tsc --noEmit --skipLibCheck`.
2. **Sync to sandbox clone** before git operations (mounted dir has unlink issues): `rsync -av --delete --exclude={node_modules,.next,.git,.vercel,*.log,.swap_trash} mounted/ sandbox/`.
3. **Commit messages**: imperative mood, explain the WHY in the body. Example commits in `git log` show the style.
4. **Push needs a GitHub PAT** — ask the user, don't store it.
5. **Update this CLAUDE.md** when you ship a meaningful pattern or hit a meaningful pitfall.

### When something breaks:
1. Check the Vercel runtime logs (`get_runtime_logs` MCP tool) for the exact error.
2. Check the deployed commit SHA matches what you expect (user might be on cached JS).
3. Check the Supabase project status (`get_project` MCP tool) — if INACTIVE, restore it.

### When dispatching a sub-agent:
- Brief it fully — agents have no memory of this conversation. Include the file paths, the contract, the constraints, the verification step.
- Use opus for hard architectural work, sonnet for mechanical work.
- Parallel agents must have non-overlapping file scopes.

---

**Last updated:** 2026-05-22. When you ship something material, update the relevant section and bump this date.
