@AGENTS.md

# Pipeline AI — Project Instructions

## What This Is

Pipeline AI is a SaaS app for field service businesses (plumbing, drain cleaning, HVAC, etc.). The first client is New York Sewer & Drain (NYSD). Field techs submit job data + photos → AI generates reports + invoices → managers approve → auto-sends to clients.

Built by Polar Bear Agency (PBA) for client Bogdan May.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Turbopack)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS v4 + shadcn/ui v4
- **Database:** Supabase (PostgreSQL + Auth + Storage + Row-Level Security)
- **Auth:** @supabase/ssr with cookie-based sessions
- **State:** Zustand for client state
- **Deployment:** Vercel (Hobby plan)

## Architecture

- **Multi-tenant:** Organization is the root entity. Every table is org-scoped via RLS.
- **Roles:** super_admin, owner, office_manager, field_tech, client
- **Subscription tiers:** basic ($49), professional ($129), business ($249)
- **Feature gates:** `src/lib/tier-limits.ts` — check `hasFeature()` before enabling tier-locked UI/logic
- **Permissions:** `src/lib/permissions.ts` — role-based action checks

## Database

- **Migrations:** `supabase/migrations/` — numbered sequentially (001, 002, ...)
- **Types:** `src/types/database.ts` — must mirror the Supabase schema exactly
- All tables have RLS enabled. Never bypass RLS from client code.
- Helper functions `public.get_user_org_id()` and `public.get_user_role()` are used in RLS policies.
- Security triggers prevent privilege escalation (role changes, billing field changes).

### Migration 001: Initial Schema
Core tables: organizations, users, clients, sites, service_catalog, client_pricing_overrides, jobs, job_line_items, invoices, bank_transactions, activity_log.

### Migration 002: Scheduling Module (Business tier)
Added: crews, crew_members, recurring_job_schedules tables. Added `scheduled` status to jobs. Added scheduling columns to jobs (scheduled_by, scheduled_end_time, estimated_duration_minutes, original_scheduled_time, reschedule_reason, crew_id, recurring_schedule_id). Updated jobs RLS to include crew-based visibility.

**Status:** Schema ready. UI not yet built. See `SCHEDULING-MODULE.md` in project root for full brainstorm.

## Activity Logging (Audit Trail)

Every significant action is logged to `activity_log` with entity_type + entity_id. The job detail page renders these as a visual timeline via `src/components/jobs/activity-timeline.tsx`.

### Standardized Job Actions

| Action | When Logged | Where |
|--------|------------|-------|
| `job_created` | Tech/manager creates a new job | `jobs/new/page.tsx` |
| `job_ai_completed` | AI finishes generating report + invoice | `api/jobs/[id]/generate/route.ts` |
| `job_approved` | Manager approves | `jobs/[id]/page.tsx` (handleStatusUpdate) |
| `job_rejected` | Manager rejects (metadata: rejection_notes) | `jobs/[id]/page.tsx` |
| `revision_requested` | Manager requests revision (metadata: revision_request) | `jobs/[id]/page.tsx` |
| `job_sent` | Report + invoice emailed to client | `api/jobs/[id]/send/route.ts` |
| `job_completed` | Job marked complete | `jobs/[id]/page.tsx` |
| `job_cancelled` | Job cancelled | `jobs/[id]/page.tsx` |
| `job_deleted` | Job soft-deleted + invoice voided | `api/jobs/[id]/delete/route.ts` |
| `report_manually_edited` | Manager edits AI report | `jobs/[id]/page.tsx` |
| `invoice_manually_edited` | Manager edits AI invoice | `jobs/[id]/page.tsx` |
| `report_regenerated` | Manager triggers AI regeneration | `jobs/[id]/page.tsx` |

**Rule:** When adding new features that modify jobs, always insert an activity_log entry with the appropriate action. Include relevant context in the `metadata` JSONB field.

## Key Patterns

### Adding a New Feature
1. If tier-locked: add feature flag to `TierConfig` in `src/lib/tier-limits.ts` (all 3 tiers)
2. If new DB tables/columns: create a new migration file (next number in sequence)
3. Update `src/types/database.ts` to match schema changes
4. If new role-gated action: add to `src/lib/permissions.ts`
5. Log user actions to `activity_log`

### Job Status Flow
```
scheduled → submitted → ai_generating → pending_review → approved → sent → completed
                                              ↓
                                         rejected (back to tech)
                                              ↓
                                    revision_requested → revised → pending_review
```

### Status Config Maps
Both `jobs/page.tsx` and `jobs/[id]/page.tsx` have a `STATUS_CONFIG` record that maps `JobStatus` → label + className. When adding a new status, update BOTH files plus the database CHECK constraint.

## File Structure (Key Paths)

```
src/
  app/
    (dashboard)/          # Authenticated pages (sidebar layout)
      jobs/               # Job list, detail, creation
      clients/            # Client CRM
      invoices/           # Invoice management
      finances/           # Financial dashboard
    api/                  # Server-side API routes
      jobs/[id]/
        generate/         # AI report + invoice generation
        send/             # Email to client
        delete/           # Soft delete + void invoice
  components/
    jobs/                 # Job-specific components
      activity-timeline.tsx  # Audit trail timeline
      photo-upload.tsx       # Photo upload widget
    layout/               # Sidebar, header, etc.
    ui/                   # shadcn/ui primitives
  lib/
    supabase/             # Client + server Supabase helpers
    pdf/                  # PDF generation (jsPDF)
    permissions.ts        # Role-based permission checks
    tier-limits.ts        # Subscription tier feature gates
  stores/                 # Zustand stores
  types/
    database.ts           # Database type definitions (source of truth)
supabase/
  migrations/             # SQL migrations (run in order)
```

## Important Constraints

- **Mobile-first:** Client may request a mobile app later. Design responsive, keep the stack compatible with React Native / Capacitor.
- **RLS everywhere:** Never trust the client. All data access goes through Supabase RLS policies.
- **No secrets in client code:** API keys, service role keys stay server-side only.
- **Soft deletes:** Jobs use `deleted_at` for archiving. Never hard delete job data.
- **Invoice numbers are permanent:** Even voided invoices keep their number for audit trail.

## Waiting On

- Sample invoice and report templates from Bogdan (client)
- Scheduling module UI implementation (schema is ready, see SCHEDULING-MODULE.md)
