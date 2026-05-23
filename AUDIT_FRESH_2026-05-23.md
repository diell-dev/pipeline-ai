# Audit on canonical main (SHA 97ce226) — 2026-05-23 (re-audit)

> **Context:** Earlier today we audited a stale local checkout and shipped 9 commits that duplicated work already on the remote. Those commits were discarded (backup tag: `backup/pre-remote-sync-2026-05-23`). This audit is on the canonical files at `origin/main`.
>
> Two migrations are applied to the live DB but were not in the remote tree:
> - `010_create_job_from_equipment_rpc.sql` — RPC exists in DB but **no route calls it**
> - `011_equipment_updated_at_trigger.sql` — trigger is live, route still sets `updated_at` manually (cleanup)

## Already-resolved (don't re-fix)
- OCR/HEIC fix, BarcodeDetector→jsQR swap, AI date decode, Sonnet 4.6 upgrade, equipment_qr_codes RLS additions — all confirmed in recent commits, no follow-up needed.

## Real bugs (will cause incorrect behavior or data loss)

1. **Start Work Order is broken** — `src/app/(dashboard)/equipment/[id]/page.tsx:217-233`. Page POSTs to `/api/jobs/new/start-from-equipment` (does not exist → 404), then falls back to `/api/jobs/${equipment.id}/start-from-equipment` **without a body** while the API requires `{ equipment_id }` (`src/app/api/jobs/[id]/start-from-equipment/route.ts:36`). Result: every click toasts "Could not start work order". Fix: drop the first attempt; call the existing route with `body: JSON.stringify({ equipment_id })`.

2. **InspectionChecklist always fails to save** — `src/components/equipment/inspection-checklist.tsx:160-164` posts `items: [{ label, result, notes }]`. API requires `checklist_item_code` AND `checklist_item_label` on each item and rejects otherwise (`src/app/api/jobs/[id]/inspections/route.ts:112`). Fix: send `{ checklist_item_code: spec.id ?? slug(label), checklist_item_label: label, result, notes }`.

3. **Equipment detail GET shape mismatch** — `src/app/api/equipment/[id]/route.ts:104-110` returns `{ equipment, scans, jobs, children, inspections }` with `category` and `site` nested *inside* `equipment`. Page (`page.tsx:322`) destructures `category`, `site`, `parent`, expects `scans[].scanned_by_name`, `jobs[].tech_name`, `inspections[].items|inspected_at|inspected_by_name`. None of those exist → page renders "Unknown" everywhere, inspection items never display, parent/children hierarchy never shows. **This is the single biggest correctness issue.**

4. **start-from-equipment orphan-job risk** — `src/app/api/jobs/[id]/start-from-equipment/route.ts:65-99` does three sequential writes without the RPC. If `equipment_jobs` insert fails the job is orphaned; if activity_log fails the audit is silently lost (no error check on line 87). Migration 010's RPC is applied to the live DB but never called. Fix: wire `supabase.rpc('create_job_from_equipment', …)`.

5. **schedule endpoint ignores assignee filters** — `src/app/api/schedule/route.ts` accepts only `from`/`to`. Any dialog or calendar that wants to show one tech/crew has to filter client-side after downloading up to 2000 rows. Fix: accept `?assigned_to=` and `?crew_id=` UUID params and apply server-side.

## Security / data hygiene

6. **GET equipment cross-org leak** — `src/app/api/equipment/[id]/route.ts:62-64`. Cross-org callers get `403 Forbidden` (after a successful read); non-existent ids get `404`. Reveals row existence across tenants. Fix: collapse both branches to `'Equipment not found'` / 404.

7. **PATCH parent_equipment_id allows cycles & cross-org parents** — `route.ts:179-188`. Fix: load the parent, verify same `organization_id`, walk `parent_equipment_id` chain (cap 20) to reject cycles.

8. **PATCH and DELETE never write activity_log** — `route.ts:212` and `route.ts:256` skip audit; only `register` logs. Fix: best-effort `equipment_updated` and `equipment_deleted` inserts.

9. **link-job route has no permission gate** — `src/app/api/equipment/[id]/link-job/route.ts:20-23` only checks authentication. Any tech can link arbitrary same-org equipment to arbitrary same-org jobs. Fix: require `jobs:edit_all` or `equipment:edit`.

10. **ai-lookup route ungated** — `src/app/api/equipment/[id]/ai-lookup/route.ts:21-23` allows any authenticated user to trigger a Claude call (cost + write). Fix: gate behind `equipment:edit`.

11. **crew_members POST allows clients in crews** — `src/app/api/crew-members/route.ts:40` accepts any same-org user, including `role='client'`. Fix: reject `role IN ('client')`.

12. **/api/schedule date-window TZ drift** — `route.ts:75-76` filters by `service_date BETWEEN from..to`. Jobs whose `scheduled_time` falls in-window but whose `service_date` is outside (recurring spawn near midnight UTC) silently disappear. TODO at line 56 acknowledges; no enforcement.

## UX / logic

13. **EditEquipmentDialog missing entirely** — `equipment/[id]/page.tsx:384` routes to `?edit=1` but page never reads `?edit` and no dialog exists in `src/components/equipment/`. **Edit button is a no-op.** (This is the exact bug you originally flagged!) Fix: build the dialog, or remove the button until built.

14. **Schedule page has no conflict check** — `src/app/(dashboard)/schedule/page.tsx` quick-create routes to `/jobs/new`; no overlap detection, no tech/crew availability surfacing.

15. **Schedule POST doesn't validate time** — `src/app/api/jobs/[id]/schedule/route.ts:50-52` only checks presence. Accepts past timestamps, end-before-start, end with no start. Fix: reject past times, require `end >= start`.

16. **Schedule POST doesn't enforce assigned_to xor crew_id mutual exclusion** — `route.ts:88-89`. Both can be set non-null simultaneously.

17. **Reschedule POST unvalidated** — `src/app/api/jobs/[id]/reschedule/route.ts:35-37` same gap.

18. **Inspections GET returns grouped object, not array** — `route.ts:196` returns `{ by_equipment: { [equipment_id]: [...rows...] } }`. No frontend consumes this; equipment detail page expects `inspections: InspectionRow[]` with grouped `items`.

19. **Equipment list expects `eq.parent` join** — `src/app/(dashboard)/equipment/page.tsx:527-531` reads `eq.parent.make`. `/api/equipment` GET joins only category + site; `parent` is always undefined → "Part of:" line never renders. Fix: add `parent:parent_equipment_id ( id, unit_number, make, model )` to the select.

20. **MyScheduleePage typo** — `src/app/(dashboard)/schedule/my-schedule/page.tsx:68` exports component name `MyScheduleePage` (extra e). Cosmetic but shows up in stack traces.

21. **Recurring page uses `prompt()` for pause date** — `recurring/page.tsx:239`. Fragile, doesn't work in modal contexts on iOS Safari. Replace with a date picker.

## Small cleanups

- `src/app/api/equipment/[id]/route.ts:210` manually sets `update.updated_at` — migration 011 trigger now handles this; line is redundant.
- `src/app/api/jobs/[id]/start-from-equipment/route.ts` — doc-comment says the URL parameter is unused. Move to `/api/jobs/start-from-equipment` and update the caller.
- `src/app/api/equipment/[id]/ai-lookup/route.ts:91` and `register/route.ts:197` hard-code `'claude-sonnet-4-6'`; pull into a constant.
- `src/app/api/equipment/route.ts:62-69` time math: `setUTCDate(getUTCDate() + days)` will be off by a day for east-of-UTC users. Document or compute in org TZ.
- `src/app/api/crews/[id]/route.ts:13-22` `loadCrew` doesn't honor super_admin — admins cannot edit crews in other orgs.

## Out-of-tree concerns

- **migration 010 RPC unused** — `create_job_from_equipment` is applied to the live DB but no route calls it. Either wire it into `start-from-equipment` (preferred — fixes finding #4) or drop the migration.
- **migration 011 trigger is fine** — equipment.updated_at trigger is live; route's manual set is harmless but redundant (small cleanup above).

## Out of scope but noteworthy

- `src/app/api/internal/cron/spawn-recurring-jobs/route.ts:241-243` exposes GET as alias of POST. Convenient for testing but means anyone with a guessed bearer token gets a side-effectful endpoint via simple GET.
- `EquipmentLifecycleWidget` fetches `/api/dashboard/equipment-lifecycle` — verify that route exists.
- `crew_members` POST returns 409 from PG 23505 only — fine — but doesn't race-check organization_id of `user_id` against the crew's org if a user moves between orgs mid-request.
