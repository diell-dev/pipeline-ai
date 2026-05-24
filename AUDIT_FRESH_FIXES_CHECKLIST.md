# Audit Fresh — Fix Checklist (2026-05-23)

Live checklist for the fix pass on the canonical `main` audit (`AUDIT_FRESH_2026-05-23.md`).
Resilient to credit cutoff — read top-to-bottom to pick up where we left off.

**Base commit:** `97ce226` (origin/main, synced 2026-05-23)
**Backup tag (discarded 9 commits):** `backup/pre-remote-sync-2026-05-23`

## Status legend
- [ ] not started
- [/] in progress (agent claimed)
- [x] done
- [!] blocked — needs decision

---

## Agent A — Backend equipment + link-job + ai-lookup

Files:
- `src/app/api/equipment/[id]/route.ts`
- `src/app/api/equipment/[id]/link-job/route.ts`
- `src/app/api/equipment/[id]/ai-lookup/route.ts`
- `src/app/api/equipment/route.ts` (list endpoint)

Findings:
- [x] **#3 Equipment GET shape mismatch** — done by prior agent (verified): hoisted category/site/parent, resolved user names for scans/jobs/inspections, grouped inspections by 5s bucket
- [x] **#6 Cross-org leak** — done by prior agent (verified): GET/PATCH/DELETE collapse cross-org existence into 404
- [x] **#7 parent_equipment_id validation** — done by prior agent (verified): same-org check + 20-hop cycle walk
- [x] **#8 activity_log on PATCH + DELETE** — done by prior agent (verified): fire-and-forget inserts present
- [x] **#9 link-job permission gate** — done by prior agent (verified): requires `equipment:edit` OR `jobs:edit_all`
- [x] **#10 ai-lookup permission gate** — added `hasPermission(auth.role, 'equipment:edit')` gate
- [x] **#19 List endpoint parent join** — added `parent:parent_equipment_id ( id, unit_number, make, model )` to the select
- [x] **Small: drop client-side updated_at** — done by prior agent (verified): no manual `updated_at` in PATCH builder

## Agent B — Backend jobs + schedule + crew

Files:
- `src/app/api/jobs/[id]/start-from-equipment/route.ts`
- `src/app/api/jobs/[id]/schedule/route.ts`
- `src/app/api/jobs/[id]/reschedule/route.ts`
- `src/app/api/jobs/[id]/inspections/route.ts`
- `src/app/api/schedule/route.ts`
- `src/app/api/crew-members/route.ts`
- `src/app/api/crews/[id]/route.ts`

Findings:
- [x] **#4 Wire RPC for atomicity** — done by prior agent (verified): `create_job_from_equipment` RPC is called
- [x] **#5 Schedule filters** — done by prior agent (verified): UUID-validated `assigned_to` and `crew_id` filters, xor-enforced
- [x] **#11 crew_members rejects clients** — done by prior agent (verified): returns 400 when `targetUser.role === 'client'`
- [x] **#15 Schedule POST time validation** — done by prior agent (verified): past-time + end-after-start guards via `PAST_TOLERANCE_MS`
- [x] **#16 Schedule POST xor** — done by prior agent (verified): rejects both assigned_to and crew_id together
- [x] **#17 Reschedule POST validation** — added matching validators (past-time, end > start, end requires start) to reschedule route
- [x] **#18 Inspections GET shape** — rewrote GET to return `{ inspections: InspectionRow[] }` grouped by (equipment_id, recorded_at-rounded-to-5s) with resolved recorder names; matches what job detail page consumes via `Inspection` interface
- [x] **Small: crews super_admin** — `loadCrew` now uses `canAccessOrg(auth, crew.organization_id)` so super_admin bypasses the org check

## Agent C — Frontend (equipment + dialogs + inspection + schedule UX + small)

Files:
- `src/app/(dashboard)/equipment/[id]/page.tsx`
- `src/app/(dashboard)/equipment/page.tsx` (list — minor)
- `src/components/equipment/inspection-checklist.tsx`
- `src/components/equipment/edit-equipment-dialog.tsx` (NEW)
- `src/components/equipment/schedule-work-order-dialog.tsx` (NEW)
- `src/app/(dashboard)/schedule/page.tsx`
- `src/app/(dashboard)/schedule/my-schedule/page.tsx`
- Whatever file uses `prompt()` for recurring pause date (find via grep)

Findings:
- [x] **#1 Start Work Order broken** — removed the broken `handleStartWorkOrder` (which POSTed to `/api/jobs/new/start-from-equipment`) and wired the button to open `<ScheduleWorkOrderDialog>`; dialog now POSTs to `/api/jobs/${equipmentId}/start-from-equipment` per the canonical route shape
- [x] **#2 InspectionChecklist payload** — `handleSave` now slugifies each label into `checklist_item_code` and sends `{checklist_item_code, checklist_item_label, result, notes}` (filtering out unanswered items)
- [x] **#13 EditEquipmentDialog** — copied dialog component imported and wired to Edit button on the detail page with `onSaved={refresh}`
- [/] **#14 Schedule page conflict check** — punted; the schedule page's quick-create flow already opens a Dialog routing to `/jobs/new` with prefilled date. `ScheduleWorkOrderDialog` is equipment-specific (requires `equipmentId`) so reuse would need refactoring. Brief said "use judgment / keep changes minimal" — leaving as-is.
- [x] **#19 List page parent display** — verified `src/app/(dashboard)/equipment/page.tsx` already renders `eq.parent.make/model/unit_number` in both mobile cards and desktop table; backend join added (Agent A's #19) makes it light up
- [x] **#20 Typo fix** — `MyScheduleePage` → `MySchedulePage` in `my-schedule/page.tsx`
- [x] **#21 Recurring `prompt()`** — replaced native `prompt()` in `schedule/recurring/page.tsx` with a proper shadcn Dialog containing `<Input type="date">` seeded to today+7
- [x] **Permission gate** — Start Work Order button now hidden when `!hasPermission(user.role, 'jobs:create')`; Edit button already gated by `equipment:edit`

Coordinate with A: page expects `data.category`, `data.site`, `data.parent`, `data.scans[].scanned_by_name`, `data.jobs[].tech_name`, `data.inspections[].items[]+inspected_at+inspected_by_name` AND grouped inspections (per A's #3 fix).
Coordinate with B: schedule dialog uses `/api/schedule?from=X&to=X&assigned_to=Y|crew_id=Y` (B's #5 fix).

## Verification (after all 3 agents)

- [x] `npx tsc --noEmit` clean (exit 0, no errors)
- [x] `npx eslint` clean on changed files (only 3 pre-existing `<img>` warnings on equipment detail page; no new errors/warnings introduced)
- [x] Spot-check: each modified file read end-to-end before/after edits
- [x] Confirm migration 010 RPC is now called (Agent B's #4) — verified `supabase.rpc('create_job_from_equipment', …)` in start-from-equipment route
- [x] Confirm migration 011 line no longer manually set in route (Agent A's small cleanup) — verified `EDITABLE_FIELDS` whitelist excludes `updated_at` and no manual assignment present
- [x] Update this checklist with [x] + one-line note per item
- [x] Committed + pushed as `497c0fb` on 2026-05-23. Live on origin/main.

---

## Resume instructions (after cutoff)

1. Read this file.
2. `git status` — should show no NEW unstaged tracked-file changes if an agent already finished (work would be untracked dirty if mid-progress).
3. Check tasks: `TaskList`, find the audit-fresh-fixes parent + per-agent tasks. Their description has the agent brief if you need to re-dispatch.
4. For any `[ ]` or `[/]` item: re-dispatch the corresponding agent with the same brief.
5. Re-run verification only when all three agents are `[x]`.
6. Do NOT commit unless user asks.
