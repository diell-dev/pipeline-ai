# Phase A — Recommendations (Pipeline AI Look & Feel)

**Status:** Awaiting your sign-off before Phase B begins.
**Vibe direction approved:** trustworthy / professional (Stripe / Linear feel).
**Dark mode:** v1 (included).
**Per-tenant branding:** preserved — your existing `BrandProvider` keeps overriding `--brand-primary` and `--brand-accent` per organization. The default tenant (Polar Bear Agency / NYSD) needs new defaults.

**👉 Open `PHASE_A_PREVIEW.html` in your browser** — toggle the four palettes and two fonts in light + dark mode to make the decision visually.

---

## TL;DR — The recommendation

> **Palette:** Option A — Slate-900 primary `#0F172A` + Sky-700 accent `#0369A1`.
> **Typography:** Geist for both heading and body (already loaded; one family, zero new requests).
> **Spacing:** 4px base, 14-step scale.
> **Radius:** 7 steps; `xl (12px)` as the card default.
> **Shadows:** 4 elevations (sm / md / lg / xl), used semantically (card / floating / popover / modal).

This gives you the Stripe / Linear / Vercel feel you asked for, costs **zero new font requests** (Geist is already in `layout.tsx`), and lets the per-tenant override system keep working unchanged.

---

## 1. Color palette — 4 options

The current default is Polar Bear's brand (Option D). All four below honor your "cool tones, restrained, no warm-saturated" direction and ship with first-class dark mode. **Pick one as the Pipeline AI / NYSD default tenant brand.** Any tenant can still override via `/settings/branding`.

| | Option A — **RECOMMENDED** | Option B | Option C | Option D — current |
|---|---|---|---|---|
| **Name** | Slate + Sky | Slate + Emerald | Charcoal + Amber | Navy + Neon |
| **Primary** | `#0F172A` slate-900 | `#1E293B` slate-800 | `#171717` neutral-900 | `#05093D` |
| **Accent** | `#0369A1` sky-700 | `#10B981` emerald-500 | `#F59E0B` amber-500 | `#00FF85` |
| **Vibe** | Stripe / Linear — calm, engineered, trustworthy | Field-service modern — cool primary + green action color (echoes Polar Bear) | Bold, premium — Vercel-black + warm CTA | High-contrast tech — feels closer to consumer than B2B |
| **Risk** | Could be "too generic" if not used with discipline (mitigated by tokens + density rules) | Emerald + danger-red on same screen can clash in dense lists | Amber and warning-amber will collide — use only if amber is reserved for CTA, never status | Neon green on a white surface can read as "playful," works against the "trustworthy" brief |
| **Per-tenant safety** | Best — neutral enough to coexist with any tenant override | Strong — green CTA generalises well | Risky — black is harder to pair with bright tenant overrides | Risky — neon green sets a tone tenant overrides have to compete with |
| **Dark mode** | Excellent — slate inverts cleanly | Excellent | Excellent — but black-on-black tiles feel flat without subtle blue undertone | OK — neon green stays loud in dark mode |

### Why I'm recommending **Option A**
1. **It matches your stated vibe** — Stripe (slate + cyan-blue) and Linear (graphite + electric blue) are exactly this pairing.
2. **It's per-tenant-friendly** — slate is the most neutral primary; any tenant override (even a saturated brand color) sits on top of it without clashing with the neutral scale.
3. **Dark mode is straightforward** — slate-900 → slate-100 inverts predictably, sky stays the same hue.
4. **Status colors don't collide** — green = success, amber = warning, red = danger, blue = info, sky = brand. Five distinct hues, all readable simultaneously.
5. **It signals B2B trust** — your customers are running real businesses; cool tones say "infrastructure," not "consumer app."

### If you want to differentiate from "generic SaaS"
Pick **Option B (slate + emerald)**. The green accent echoes Polar Bear's existing green and reads as "growth / completion / flow" — appropriate for sewer & drain (pipes flow). I'd still keep slate as the primary; emerald becomes the single accent for primary CTAs.

### If you want bolder
Pick **Option C (charcoal + amber)** — premium and uncommon in field-service SaaS, but the amber accent will collide with `--status-warning` (also amber). You'd have to mentally reserve amber for "brand action" and amber-500 for "warning," which adds load.

---

## 2. Typography — 2 options

| | Option 1 — **RECOMMENDED** | Option 2 |
|---|---|---|
| **Strategy** | Single family — Geist (heading + body) | Tight pairing — Inter Tight (heading) + Inter (body) |
| **Headings** | Geist 600/700, `-0.01em` tracking | Inter Tight 700, `-0.02em` tracking |
| **Body** | Geist 400/500, `0` tracking | Inter 400/500 |
| **Mono** | Geist Mono | Geist Mono |
| **Network cost** | ✅ Zero — already loaded via `next/font/google` in `layout.tsx` | One extra family weight (Inter Tight) — ~30 KB |
| **Tabular numerals** | ✅ Native | ✅ Native |
| **Feel** | Vercel / Linear — engineering taste | Notion / Cron — slightly warmer |
| **Risk** | None — already in the build | New font request adds slight FOUT risk |

### Why I'm recommending Geist
You already load it. It was designed for product UIs (Vercel made it). Variable-font, tabular-numeral native, OpenType features for `cv11`/`ss01`/`ss03` that give you the precise feel without needing two families. **Adopting it as the actual product face costs zero work.**

If you want more contrast between page titles and body, we can just use **Geist 700 with `-0.02em` tracking** for hero/page titles. Same family, more drama.

---

## 3. Spacing scale

Base unit: **4px**.

| Token | Value | Use |
|---|---|---|
| `space-0` | 0 | reset |
| `space-1` | 4px | tight icon + label |
| `space-2` | 8px | chip rows, icon gap |
| `space-3` | 12px | label + control |
| `space-4` | 16px | mobile card padding, in-card stack |
| `space-5` | 20px | card header padding |
| `space-6` | 24px | desktop card padding, cards in column |
| `space-8` | 32px | section gap |
| `space-10` | 40px | sub-page top spacing |
| `space-12` | 48px | page section break |
| `space-16` | 64px | hero spacing |
| `space-20` | 80px | major section break |
| `space-24` | 96px | hero vertical breathing |
| `space-32` | 128px | landing page section gap |
| `space-40` | 160px | landing page hero zone |

This already matches Tailwind defaults, so existing code doesn't need to change.

---

## 4. Radius scale

| Token | Value | Use |
|---|---|---|
| `radius-none` | 0 | tables, hairlines |
| `radius-sm` | 4px | input chips, small badges |
| `radius-md` | 6px | buttons, small popovers |
| `radius-lg` | 8px | inputs, default control |
| `radius-xl` | **12px** | **cards (default)** |
| `radius-2xl` | 16px | hero cards, modal |
| `radius-full` | 9999px | pills, avatars |

Recommendation: **default card radius = `xl` (12px)**. The current shadcn default is `0.625rem` (10px) — bumping to 12px gives the "feels intentionally crafted" lift without going so round it looks consumer-toy.

---

## 5. Shadow scale (elevation)

Four steps, used semantically — never decoratively.

| Token | Value | Role |
|---|---|---|
| `shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.04)` | **card** (default) |
| `shadow-md` | `0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)` | floating button / hover lift |
| `shadow-lg` | `0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)` | **popover** |
| `shadow-xl` | `0 12px 24px -8px rgb(0 0 0 / 0.12), 0 4px 8px -4px rgb(0 0 0 / 0.06)` | **modal** |

Dark mode collapses `shadow-sm → none` (cards rely on the border + lighter surface for separation; shadows look fake on dark).

---

## 6. Motion scale

Already defined in tokens. To use in Phase F:

| Token | Value | Use |
|---|---|---|
| `duration-instant` | 75ms | press-down feedback |
| `duration-fast` | **150ms** | hover state, color swap |
| `duration-normal` | 250ms | dialog open, sheet slide |
| `duration-slow` | 400ms | route transition (rarely) |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | almost everything |
| `ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | success check / dialog open |

`prefers-reduced-motion` must be honored — Phase B–C work all wraps animations in `motion-safe:`.

---

## 7. Live preview

**File:** `PHASE_A_PREVIEW.html` at project root.

Open it in any browser to see:
- A mocked dashboard surface (sidebar + page header + KPI strip + table + form)
- Button family (primary / accent / secondary / ghost / disabled, three sizes)
- Type scale with size + weight + tracking annotations
- Token swatches (brand, surfaces, text, statuses)
- Elevation tiles (4 shadow steps)

Use the three control groups at the top to swap:
- **Palette** — A / B / C / D
- **Font** — Geist / Inter
- **Theme** — Light / Dark

The file is fully self-contained — no build, no server, just open it.

**👉 To approve Option A + Geist + dark mode:** load the preview, click around all combinations, then confirm. I'll start Phase B from there.

---

## 8. Files created in Phase A

| File | Purpose | Touches UI? |
|---|---|---|
| `docs/brand-guidelines.md` | Voice, tone, visual personality, color philosophy, type philosophy, density | No |
| `assets/design-tokens.json` | Machine-readable token spec (3 layers) | No |
| `assets/design-tokens.css` | CSS variables (primitive + semantic + component, light + dark) | No (not yet imported into `globals.css`) |
| `tailwind.config.ts` | IDE / lint compat + token → utility map documentation | No |
| `DESIGN_SYSTEM.md` (project root) | How to use the tokens, anti-patterns, per-tenant interaction, dark mode | No |
| `PHASE_A_PREVIEW.html` (project root) | Interactive visual preview of the recommendation | No |
| `PHASE_A_RECOMMENDATIONS.md` (this file) | The deliverable to approve | No |

**Zero user-visible changes ship in this phase.** Every existing component still renders identically.

---

## 9. Diff impact — what changes if you approve

Approving sets Phase B in motion. Here's what would change, in order:

### Phase B — Visual identity uplift (~1 day, 1-2 agents)
- `src/app/globals.css` → `@import "../../assets/design-tokens.css"` at top; replace old `--background`, `--foreground`, etc. with semantic tokens.
- `src/app/layout.tsx` → already loads Geist, no font change needed if Option 1 typography wins. If Option 2 wins, add Inter Tight import.
- `src/lib/theme.ts` → no behavior change; brand provider already does what we need.
- Every status badge / status pill in `src/components/**` migrates to `StatusBadge` (already exists per UX_LOOK_FEEL_PLAN.md).
- Sweep for `bg-zinc-50` → `bg-surface-muted`, `text-zinc-700` → `text-text-primary`, etc.

### Phase C — Component pass (~1.5–2 days)
- `src/components/ui/button.tsx` — rewrite variants to use `button-primary-*` tokens.
- `src/components/ui/card.tsx` — `bg-card` → `bg-surface-elevated`, default radius `xl`.
- `src/components/ui/input.tsx` — 44px height, `border-focus` ring, error state.
- `src/components/ui/badge.tsx` / `StatusBadge.tsx` — pulled from semantic status tokens.
- New: `EmptyState`, `KpiCard`, `PageHeader` reusable components.

### Phase G — Dark mode (~1 day, after C lands)
- Add toggle in user menu (top-right) using existing `next-themes`.
- Audit pages in dark, fix any contrast issues uncovered.
- Status pills, charts, KPI numbers tested in dark.

**Estimated total time** for B + C + G with this Phase A foundation: ~3.5–4 days. Without the foundation: easily double that, with the inconsistency that comes from each agent inventing tokens as they go.

---

## 10. What I need from you

1. **Pick a palette.** A (recommended), B, C, or D. Or a counter-suggestion.
2. **Pick a typography option.** 1 (Geist-only, recommended) or 2 (Inter Tight + Inter).
3. **Confirm radius default.** `xl` (12px) recommended.
4. **Confirm dark mode in v1.** Already assumed yes per your brief — confirm once more.
5. **Anything you want different** about voice/density/color philosophy in `docs/brand-guidelines.md`.

Once approved, I'll trigger Phase B and start the visible uplift.

---

## 11. Anything surprising / blocked

- **Tailwind v4, not v3.** The project uses `@tailwindcss/postcss` (v4), which means configuration lives in `globals.css` via `@theme`, not in `tailwind.config.ts`. I still created `tailwind.config.ts` for IDE compat + documentation, but the **runtime source of truth is `globals.css`**, and Phase B will `@import` `assets/design-tokens.css` into it. Worth flagging because it's the opposite of how Tailwind v3 projects work.
- **`assets/design-tokens.css` is NOT yet imported into `globals.css`.** This is intentional — Phase A is plumbing only, no visual change. Phase B does the wiring.
- **The existing `BrandProvider` already does exactly what we need.** No changes required to it. It will keep writing `--brand-primary` / `--brand-accent` on `<html>` and our new semantic tokens reference those variables — composition is clean.
- **The current default theme (`#05093D` navy + `#00FF85` neon)** is Polar Bear's agency identity, not Pipeline AI's product identity. The recommendation is to give Pipeline AI its own default (Option A) and let Polar Bear's tenant org override to keep its brand colors. **This is your call** — if Polar Bear IS Pipeline AI, keep D.
- TypeScript still passes (`npx tsc --noEmit` returns 0).
