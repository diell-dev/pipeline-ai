# Pipeline AI — Design System

**Status:** Phase A (Foundation) — shipping the plumbing, no UI changes.
**Source of truth:** `assets/design-tokens.json` (machine-readable) + `assets/design-tokens.css` (runtime).
**Brand voice + visual personality:** `docs/brand-guidelines.md`.

This document explains **how** the design system is structured and **how to use it** when building / editing the UI.

---

## 1. The three-layer architecture

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3 — COMPONENT                                        │
│  --button-primary-bg, --card-bg, --input-border-focus       │
│  References → Layer 2 only                                  │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2 — SEMANTIC                                         │
│  --brand-primary, --surface, --text-primary,                │
│  --status-success-bg, --elevation-card                      │
│  References → Layer 1 only.  Has dark variants.             │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — PRIMITIVE                                        │
│  --color-zinc-500, --space-4, --radius-lg, --shadow-md,     │
│  --duration-fast                                            │
│  Raw values. No theming. No references.                     │
└─────────────────────────────────────────────────────────────┘
```

### Why three layers
- **Primitives** never change → safe to use directly in one-off code (rare).
- **Semantics** describe ROLE, not value → safe to swap themes (light/dark/high-contrast) without touching components.
- **Components** describe a specific UI part → editing one button doesn't ripple into other buttons.

This is the same model Stripe, Linear, GitHub Primer, and Adobe Spectrum use. It scales.

---

## 2. How to use tokens

### ✅ DO

```tsx
// Use Tailwind utilities tied to semantic tokens
<button className="bg-brand-primary text-text-on-brand hover:bg-brand-primary/90">
  Send invoice
</button>

<div className="bg-surface-elevated border border-border-default rounded-xl shadow-card p-6">
  …
</div>

<span className="bg-status-success-bg text-status-success-fg border border-status-success-border">
  Paid
</span>
```

### ❌ DON'T

```tsx
// Hardcoded colors — break per-tenant theming + dark mode
<button className="bg-blue-600 text-white">…</button>

// Hex literals in className
<div style={{ backgroundColor: '#0369A1' }}>…</div>

// Reaching directly into primitive layer for app surfaces
<div className="bg-zinc-50">…</div>   // use bg-surface-muted instead
```

### Token → utility cheat sheet

| What you want | Tailwind class | CSS variable |
|---|---|---|
| Page background | `bg-surface` | `var(--surface)` |
| Card background | `bg-surface-elevated` | `var(--surface-elevated)` |
| Sunken panel | `bg-surface-muted` | `var(--surface-muted)` |
| Body text | `text-text-primary` | `var(--text-primary)` |
| Secondary text | `text-text-secondary` | `var(--text-secondary)` |
| Caption / meta | `text-text-muted` | `var(--text-muted)` |
| Default border | `border-border-default` | `var(--border-default)` |
| Brand primary surface | `bg-brand-primary` | `var(--brand-primary)` |
| Brand accent surface | `bg-brand-accent` | `var(--brand-accent)` |
| Card shadow | `shadow-card` | `var(--elevation-card)` |
| Popover shadow | `shadow-popover` | `var(--elevation-popover)` |
| Status success badge | `bg-status-success-bg text-status-success-fg` | — |
| Card radius | `rounded-xl` | `var(--radius-xl)` |

---

## 3. Per-tenant theming (do not break this)

Pipeline AI is multi-tenant. Each organization owns:
- A **primary color** (`organizations.primary_color`)
- An **accent color** (`organizations.accent_color`)
- A **logo** (`organizations.logo_url`)

`src/components/providers/brand-provider.tsx` runs on mount + on organization changes and writes:

```ts
document.documentElement.style.setProperty('--brand-primary', primaryHex)
document.documentElement.style.setProperty('--brand-accent', accentHex)
// + 10-step tint scale, --brand-primary-rgb, --brand-primary-fg, etc.
```

**This is why the token system MUST treat `--brand-primary` and `--brand-accent` as runtime-overridable.** Components reach for them via CSS variables, never via static hex.

### What's overridable per tenant
| Token | Why |
|---|---|
| `--brand-primary` | Sidebar, primary CTA — must match tenant identity |
| `--brand-accent` | Single highlight CTA / focus state — tenant identity |
| `--brand-primary-50..900` | Tint ramp computed from primary by `tintsFor()` |
| `--brand-primary-fg` | Auto-computed (white or near-black) for legible text |
| Logo (`organizations.logo_url`) | Tenant identity |

### What's NOT overridable per tenant
- Neutral scale (zinc) — keeps the product feeling cohesive across tenants
- Semantic statuses (success/warning/danger/info) — meaning must be constant
- Spacing / radius / shadow scales — structure constant
- Typography (Geist) — one product, one voice
- Motion (durations + easings) — feels constant across tenants

If a tenant uploads an extremely light primary color, the contrast helper (`getContrastingText`) auto-flips `--brand-primary-fg` so text stays legible. **Do not bypass this — never set foreground manually.**

---

## 4. How dark mode works

Dark mode is wired via class on `<html>`:

```html
<!-- Light (default) -->
<html lang="en">

<!-- Dark -->
<html lang="en" class="dark">
```

The selector `.dark, [data-theme='dark']` in `assets/design-tokens.css` flips the **semantic** tokens (surfaces invert, borders soften, text inverts). **Primitives never change.** **Brand tokens stay the same hex** — the same brand color reads as the same hue in both themes.

Status background colors switch from `*-50` (light) to translucent `rgb(... / 0.12)` (dark) so they don't feel painted-on against dark surfaces.

Components automatically pick up the new values because they reference semantic tokens, not primitives. **Build once, look good in both.**

### Toggle (to ship in Phase G)
Use [`next-themes`](https://github.com/pacocoursey/next-themes) which is already in `package.json` — it writes `class="dark"` and persists to `localStorage`, respecting `prefers-color-scheme` on first visit.

---

## 5. Anti-patterns to avoid

| Don't | Do |
|---|---|
| `text-zinc-700` on app text | `text-text-primary` |
| `bg-white` for cards | `bg-surface-elevated` |
| `border-zinc-200` | `border-border-default` |
| `shadow-sm` ad-hoc | `shadow-card` |
| New hex value for a new tenant feature | Add a semantic token; reference it |
| `transition-all duration-300` | `transition-colors duration-normal ease-standard` |
| Emoji in nav / buttons | Lucide icon |
| Three competing accent colors on one screen | One brand-accent + neutrals + one status if needed |
| Decorative colored borders to separate sections | Whitespace + `border-border-subtle` if needed |
| `font-bold text-2xl` everywhere | `text-page-title` (defined in globals.css `@layer components`) |
| Custom shadow recipes (drop, glow, etc.) | Pick from the 4-step scale (sm/md/lg/xl) |
| 0.5s "smooth" animations | 150ms hovers, 250ms transitions, 400ms max |

---

## 6. Migration path (no rip-and-replace)

**All existing components keep working.** The token system composes with what's already there.

### What's already in place
- `globals.css` — old + new variables coexist
- `BrandProvider` — keeps writing `--brand-primary` / `--brand-accent`
- `tw-animate-css` + shadcn — untouched
- Status palettes in `@layer components` (`.status-success`, `.status-warning`, …) — keep using these

### What this Phase A adds (no visual change)
- `assets/design-tokens.css` — full token plumbing (NOT yet imported into `globals.css`)
- `assets/design-tokens.json` — machine-readable source
- `docs/brand-guidelines.md` — voice + visual personality doc
- `tailwind.config.ts` — IDE compat + token → utility map documentation
- `DESIGN_SYSTEM.md` — this file

### Phase B will (with user approval)
1. `@import "../../assets/design-tokens.css"` into `globals.css`
2. Replace the inline `--background`, `--foreground`, etc. with semantic tokens
3. Sweep one component at a time: button → card → input → badge
4. Each commit is self-contained; the app keeps working between commits

### Phase C+ will
- Refine components (button, card, input, badge) to use component-layer tokens
- Add motion system
- Add dark mode toggle (Phase G)

**No big-bang rewrite. Each phase is shippable on its own.**

---

## 7. Adding new tokens

When you need a new color / spacing / shadow that doesn't exist:

1. **Is it a one-off?** → Use a primitive directly. Don't pollute the semantic layer.
2. **Will it be reused?** → Add to the semantic layer in `assets/design-tokens.css`. Give it a role-based name (`--alert-bg`, not `--my-yellow`).
3. **Is it specific to a component?** → Add to the component layer. Reference the semantic token, not a primitive.
4. **Update both:** `design-tokens.css` AND `design-tokens.json`. The JSON is the spec; the CSS is the runtime.
5. **Add a dark variant** in the `.dark` block if the semantic role implies one.
6. **Document the token** in this file's cheat sheet if it's user-facing.

---

## 8. Why this matters

A SaaS product is judged on the **first ten seconds** — does it feel **expertly built** or does it feel like a templated dashboard? The token system is what lets us:

- Make global polish changes (e.g., "all cards should sit slightly higher") in one place
- Ship dark mode without touching components
- Re-theme per tenant without breaking the app
- Onboard new contributors who can copy patterns instead of inventing them
- Audit accessibility (every token has a known contrast pair)

Tokens are the substrate. Everything visible builds on top.
