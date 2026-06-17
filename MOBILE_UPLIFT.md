# Mobile-First Uplift — Audit & Direction Lock
**Date:** 2026-05-28
**Method:** Source-read audit against impeccable, emil-design-eng, design-taste-frontend frameworks. ~38 pages reviewed, all 25 `src/components/ui/*` components scanned, plus key layout shells.

## Design Read (one line)
Reading this as: B2B field-service operations product for NYC trades (sewer/drain/HVAC), quiet-confidence visual language (Slate-900 + Sky-700 over Geist), aiming for Linear/Stripe restraint with iOS-feel mobile gestures — currently a competent web-responsive shell that has *started* mobile-app polish (bottom nav, dialog→sheet on mobile, PWA manifest + SW, safe-area-inset) but stops short of feeling native.

## What's already good (preserve)
- **Token system shipped** (`assets/design-tokens.css` 3-layer, per-tenant brand vars via `BrandProvider`) — solid foundation, do not regress.
- **Bottom nav exists** (`src/components/layout/bottom-nav.tsx`) with `env(safe-area-inset-bottom)`, primary slots role-aware, overflow→bottom sheet (good iOS pattern).
- **Dialog auto-docks as bottom sheet on mobile** (`src/components/ui/dialog.tsx:79-99`) — slides up from bottom, snaps `max-h-[92dvh]`, respects safe-area pb. This is the right call.
- **PWA infra in place**: `src/app/manifest.ts`, `public/sw.js`, `apple-icon.tsx`, `icon.tsx`, `appleWebApp` metadata, `themeColor: '#0f1a2e'` matches header. Installable.
- **Skeletons over spinners** mostly applied (jobs, clients, invoices, equipment use `SkeletonList`); `Button` has width-preserving loading state (`loading` prop).
- **Tap-down feedback**: `motion-safe:active:scale-[0.97]` on buttons + chips — proper iOS tactile response, gated by reduced-motion.
- **Page-fade-in keyed on pathname** (`src/app/(dashboard)/layout.tsx:48`) — basic route transition.
- **Geist** used (not Inter default) — passes design-taste-frontend.
- **PageHeader / KPICard / EmptyState** standardised — kills layout drift.
- **`pb-24`/`pb-20` mobile clearance for bottom nav** present on most pages (dashboard, jobs, invoices).
- **Custom easings declared** (`--ease-out-strong`, `--ease-in-out-strong`, `--ease-drawer`) per Emil playbook.

## What feels webby on mobile (fix)

### Critical (blocks the "feels native" goal)
1. **Input height 32px (`h-8`)** — `src/components/ui/input.tsx:12`. Apple HIG = 44pt min, Android Material = 48dp. This is the single biggest "webby" tell on every form (login, add-client dialog, invoice filter, equipment search). Fix: bump base to `h-11` (44px) on mobile, allow `data-density=compact` desktop override. Cascades to `Select` trigger (`select.tsx:44`, also h-8) and `SelectTrigger`.
2. **No swipe-back gesture, no swipe-actions on list rows** — Jobs / Invoices / Clients / Equipment lists render as `<Card onClick={navigate}>`. iOS users expect right-swipe-back and left-swipe-to-reveal-actions (Mark Paid, Void). Fix: add a `<SwipeableRow>` wrapper for lists; for back-nav, intercept history at the page-transition layer.
3. **No pull-to-refresh anywhere.** Jobs / invoices / equipment / schedule are stale until a route change. Fix: install `react-use-gesture` or roll a `usePullToRefresh()` hook; wire to existing `loadJobs`/`loadInvoices` reloads.
4. **Page transition is a fade, not a slide.** `page-fade-in` re-keys on pathname but iOS push = horizontal slide; tab-switch in bottom nav = crossfade. Conflating them feels off. Fix: detect nav direction (push vs. bottom-tab) and pick `slide-in-from-right` vs `fade-in` accordingly.
5. **Sheet uses `ease-in-out` and same enter/exit timing.** `src/components/ui/sheet.tsx:56` — `transition duration-200 ease-in-out`. emil rule: `ease-in` on UI = fail; exit should be faster than enter. Fix: split to `data-open:duration-250 data-open:ease-[--ease-drawer]` and `data-closed:duration-150 data-closed:ease-[cubic-bezier(0.4,0,1,1)]`.
6. **No drag-handle on the dialog-as-sheet.** When `Dialog` docks bottom on mobile (`dialog.tsx:79`), there's no visible grab handle and no swipe-down-to-dismiss. Users will look for it. Fix: add the 36px×4px pill at top inside `DialogContent` (mobile-only) and wire `pan-down → close` gesture with spring.

### High (clearly improves mobile experience)
7. **Custom dropdown in jobs/page.tsx (`l.221-267`) is a desktop-style positioned `absolute` popup.** Shadows below the trigger, no bottom-sheet variant for mobile. Should become a `Sheet side="bottom"` at <md. Same problem in `invoices/page.tsx:283-296` (client filter) and `equipment/page.tsx` (site/category dropdowns).
8. **`<select>` native element used directly** in `invoices/page.tsx:298-313` and `clients/page.tsx:283-294, 299-309`. iOS renders this as a wheel picker (fine), but Android Chrome renders a plain dropdown that looks alien against the Slate/Sky shell. Migrate to the styled `<Select>` component.
9. **Schedule page hides Week/Day/Month view tabs on mobile** (`schedule/page.tsx:314`), forces list view. Defensible — but no way to switch back to a swipeable week strip. Add a horizontally-scrollable 7-day chip strip at top of mobile list view.
10. **Toasts (Sonner) appear top-right on mobile** (default config), where they're hard to reach and clipped behind the header. Verify `sonner.tsx` config and set `position="top-center"` on mobile.
11. **Optimistic UI missing on Mark Paid / Void** — `invoices/page.tsx:230-248`: `setVoidingId`, awaits API, then refetches. Feels webby. Apply optimistic flip + rollback on error.
12. **No haptic feedback** on any tap-down. iOS `navigator.vibrate(10)` (Android) / `Haptics.impactOccurred('light')` (PWA) on primary actions would push the feel sharply native. Light touch — add to `Button onClick` and chip taps.
13. **Status-bar tint when scrolling**: `themeColor: '#0f1a2e'` is dark slate but the dashboard surface is `bg-zinc-50` (light). On install, the status bar reads dark but content is light — jarring. Either set theme-color to match `--surface` (`#ffffff`) or add a dark top safe-area strip.
14. **Login page split-screen panel stacks tiny on mobile** (`login/page.tsx:103-185`): the value-prop list is `hidden lg:flex`, so mobile users see a thin gradient strip with a 10px logo + 1 line of value prop. Either expand to a small hero block or compact to just the wordmark.

### Medium (polish)
15. **Filter pills row in `jobs/page.tsx:307-373` scrolls horizontally but has no scroll-snap and no fade edge** — feels desktop-grid-shoved-into-mobile. Add `snap-x snap-mandatory` and a left/right fade mask.
16. **Bottom-nav active state is a 0.5px top hairline** (`bottom-nav.tsx:131`) — easy to miss. iOS standard is bolder icon + label color. Already does color, but the hairline is overkill — drop it, lean on color + slight icon scale.
17. **`row-stagger-up` animation on lists** (jobs/invoices/clients) — exists, but every row gets `--row-index` so the 30th row delays ~900ms which feels slow on a long list. Cap stagger at 8 items.
18. **Dashboard sticky filter bar uses `backdrop-blur` + `bg-background/80`** (`dashboard/page.tsx:542`) — works, but on mobile this competes with the bottom nav's own backdrop. Verify no z-fighting.
19. **Equipment list uses emoji fallback `🛠️`** (`equipment/page.tsx:127`) — DESIGN_SYSTEM.md forbids emoji in nav/buttons; this is in data so borderline, but feels webby vs. a lucide icon.
20. **Loading states still show centered `<Loader2 className="animate-spin">`** in `invoices/page.tsx:569` (delete dialog) and `jobs/[id]/page.tsx`. Replace with skeleton or inline spinner-in-button.

## Component-level emil-design-eng failures
| File | Line | Issue |
|---|---|---|
| `src/components/ui/sheet.tsx` | 56 | `transition duration-200 ease-in-out` — `ease-in-out` is the weakest curve; should use `--ease-drawer` (custom) and split enter/exit. |
| `src/components/ui/sheet.tsx` | 56 | Translate amount `[2.5rem]` (40px) on enter/exit — fine, but no spring overshoot like Dialog has on desktop. |
| `src/components/ui/dialog.tsx` | 36 | `bg-black/40 duration-150` on backdrop — fade duration matches enter; backdrop fade-out should be ~100ms (snap-away). |
| `src/components/ui/button.tsx` | 17 | Uses `transition-[transform,background-color,color,box-shadow,border-color,opacity]` — good, NOT `transition-all`. ✅ |
| `src/components/ui/popover.tsx` | 40 | `duration-100` enter, no exit difference. Add `data-closed:duration-75`. |
| `src/components/ui/dropdown-menu.tsx` | 44 | Same — `duration-100` for both states. |
| `src/components/ui/select.tsx` | 92 | `duration-150 ease-out-strong` is correct ✅ |
| `src/components/dashboard/dashboard-hero.tsx` | 103, 188 | `transition-all duration-150` — limit to `transition-[transform,background-color,opacity]`. |
| `src/app/(dashboard)/jobs/page.tsx` | 329 | `transition-all duration-150` chip — same fix as above. |
| `src/app/(dashboard)/jobs/[id]/page.tsx` | 1189 | `transition-all` on photo thumbnails. |
| `src/app/(dashboard)/settings/branding/page.tsx` | 466 | `transition-all` on color-swatch button. |
| `src/components/layout/app-sidebar.tsx` | 78 | `transition-all duration-200` on the sidebar wrapper — desktop only, acceptable but tighten. |
| `src/components/ui/switch.tsx` | 19 | `transition-all` on switch — fix to `transition-colors,transform`. |
| `src/components/ui/badge.tsx` | 12 | Already uses specific properties ✅ |
| `src/components/ui/tabs.tsx` | 61 | `transition-all` on trigger — fix. |

**No `scale(0)`, no `transform-origin: center` on popover, no animation-on-keyboard-action violations found.** Buttons have `:active scale-[0.97]` ✅. Reduced-motion respected in 17 spots via `motion-safe:` / `motion-reduce:`.

## Copy audit findings
- **Em-dashes used heavily in copy**: 30+ files including hero (`login/page.tsx:150,196`), settings, schedule, invoice empty states. impeccable bans them outright. Sweep with `—` → ` – ` (en-dash) or rephrase. Special cases: schedule list separators "Mon — Tue" should be en-dash.
- **No buzzword violations found** (no `streamline`, `seamless`, `empower`, `leverage`, `world-class`, `enterprise-grade`). ✅
- **Vague button labels** found:
  - `clients/page.tsx:373`: "Cancel" — fine in pair with "Add Client", keep.
  - `clients/page.tsx:383`: "Add Client" — verb+object ✅
  - `invoices/page.tsx:561`: "Cancel" / `:577` "Delete" — for destructive, prefer "Delete invoice" to keep verb+object pairing in the dialog where the object is implicit.
  - `schedule/page.tsx:401`: "Cancel" / `:415` "Create Job" ✅
  - Login: "Sign in" — fine, conventional.
- **Settings page**: `email/page.tsx:319` reads "directly from your business email — no API keys needed" — em-dash + slight LLM-cute "no X needed" phrasing. Acceptable but watch.
- **Test-AI page** has cute copy: "sandbox — nothing saved" (`test-ai/page.tsx:297`), "no charge — this was a warranty callback" (`:241`). Acceptable in a sandbox label.
- **`opengraph-image.tsx:17`** and `layout.tsx:32,61`: brand tagline "Pipeline AI — Smart Field Service Automation" / "Field service operations that don't lose track." Both have em-dashes — replace with colon or en-dash.

## Coordination notes for the other agents

**M2 (likely component/touch-target sweep)** should specifically tackle:
- Input/Select/Button base heights → mobile-44pt (#1)
- Sheet enter/exit timing split + drag handle on Dialog (#5, #6)
- Native `<select>` migration (#8)
- `transition-all` removal in the 14 component instances listed above

**M3 (likely page-level / gesture work)** should specifically tackle:
- Swipe-back router intercept (#2)
- Pull-to-refresh hook + wiring on 4 list pages (#3)
- Page transition direction detection (#4)
- Swipe-actions on Jobs/Invoices/Clients/Equipment rows (#2)
- Custom mobile dropdown → bottom-sheet conversion in jobs/invoices/equipment (#7)

**M4 (likely polish + PWA + copy)** should specifically tackle:
- Em-dash global sweep (copy audit above)
- Status-bar tint reconciliation (#13)
- Toast position (#10)
- Haptic feedback on primary CTAs (#12)
- Optimistic UI on Mark Paid / Void (#11)
- Login mobile panel collapse (#14)
- `row-stagger-up` cap at 8 (#17)

## Mobile direction lock
- **Navigation pattern:** bottom tab bar (✓ have, in `bottom-nav.tsx`) + iOS-feel page transitions: slide-from-right for `router.push` to detail pages, crossfade for bottom-nav tab switches. Implement via a `<RouteTransition>` wrapper around `{children}` in dashboard layout that compares `pathname` direction.
- **Modal pattern:** bottom sheet on mobile (✓ Dialog does this), centered dialog on desktop, with **drag-handle pill** at top of sheet, **swipe-down-to-dismiss** gesture, and snap points `[0.5, 0.92]` of dvh. Default to 0.92 for forms, 0.5 for confirms.
- **Touch standards:** **44pt min** on all interactive targets (currently violated by `h-8` Input/Select); no hover-only interactions (all hover states must also fire on `:active` or `:focus-visible`).
- **Motion:** custom cubic-bezier curves (✓ defined as `--ease-out-strong`, `--ease-in-out-strong`, `--ease-drawer`) — **enforce specific `transition-[property,property]` lists**, never `transition-all`. Springs (overshoot ~1.05x) for drag-end snaps and sheet open. **`prefers-reduced-motion: reduce` always respected** — already done in 17 places; standardise via a `useReducedMotion()` hook.
- **Optimistic UI** on mutating actions (Mark Paid, Void, Approve, Reject) — flip local state immediately, rollback on error toast.
- **Haptics:** `light` on chip/button tap, `medium` on swipe-action commit, `success/error` on toast.
- **Skeletons over spinners** everywhere (mostly done; clean up the 2 remaining `<Loader2>` blocks).
- **PWA:** already installable; verify status-bar/theme-color alignment with the light surface and add an offline empty-state for list pages.
- **Typography cap:** Geist Sans + Geist Mono only (2 families ✓). Heading scale tops at `text-4xl` (login hero `xl:text-5xl` is on a centered marketing surface, defensible).
- **No nested cards.** Currently clean — Jobs list shows `Card → CardContent`, no double-Card. Maintain.
- **No side-stripe borders** as decoration. The amber action banner (`jobs/page.tsx:275`) uses `border-2` all around, not a stripe ✅.
