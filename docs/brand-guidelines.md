# Pipeline AI — Brand Guidelines

**Version:** 1.0 (Phase A — Design System Foundation)
**Last updated:** 2026-05-25
**Audience:** anyone touching the Pipeline AI product surface, marketing site, or per-tenant defaults.

---

## 1. Brand at a glance

Pipeline AI is field-service infrastructure for trades businesses (plumbing, sewer & drain, HVAC, electrical). The product replaces manual invoicing and reporting with an automation-first workflow.

The brand DNA is **quiet confidence**. Think **Stripe** (precision + trust), **Linear** (taste + restraint), **Vercel** (engineering clarity) — not consumer-cute, not enterprise-brittle. Operators in the field need a tool that feels reliable, fast, and respectful of their time.

---

## 2. Voice & tone

| Trait | What it sounds like | What it does NOT sound like |
|---|---|---|
| **Professional but warm** | "We've prepared your invoice. Review it before sending." | "Hey there! Your invoice is ready to go" |
| **Direct** | "3 invoices overdue." | "It looks like there might be a few invoices that could use your attention." |
| **Jargon-light** | "Pending review", "Sent to client" | "Awaiting QA gate", "Outbound delivery state: pending" |
| **Action-oriented** | "Mark as paid", "Send proposal" | "Status update", "Document workflow action" |
| **Treats users as competent professionals** | "Tax rate (%)", with no tooltip | "What's a tax rate? Tap here to learn more" |

### Voice rules
1. **Verbs over nouns.** "Send invoice" beats "Invoice sending".
2. **Sentence case everywhere** except product name (`Pipeline AI`) and proper nouns. No Title Case Buttons. No SHOUTING.
3. **Numbers are typeset.** Use tabular numerals (`tabular-nums`) for any column of amounts, counts, or dates.
4. **No emojis as system icons.** Emojis are fine **inside content** (e.g. equipment category labels), never in UI chrome.
5. **Error copy explains what happened AND what to do.** "Couldn't save the proposal — check your internet connection and try again" beats "Error 500".
6. **Confirmations are calm.** "Invoice sent" — not "Awesome! Your invoice has been sent successfully!"

---

## 3. Visual personality

| Principle | Application |
|---|---|
| **Quiet confidence** | Restrained color, generous whitespace, minimal decoration. The product gets out of the user's way. |
| **Precise typography** | One typeface family (Geist) across the product. Tight headings, comfortable body, tabular numerals for data. |
| **Restrained color** | One brand color (per tenant). One accent (per tenant). Neutrals carry 90% of the UI. Color signals meaning — it doesn't decorate. |
| **Generous whitespace** | Default to more padding, not less. Density is "comfortable, never cramped, never wastefully airy." |
| **Subtle elevation** | 4 shadow steps maximum. Cards lift on hover by ~2px, no more. |
| **Subtle motion** | 150ms for hovers, 250ms for transitions, 400ms for big page swaps. `prefers-reduced-motion` always respected. |

### What we avoid
- Gradients that don't carry meaning
- Drop shadows used as decoration
- Multiple competing accent colors on one screen
- Decorative iconography in chrome (only meaningful icons)
- Animations longer than 400ms
- Skeuomorphic textures, glassmorphism blur stacks, neumorphism
- Centered body text in dashboard surfaces (left-align)

---

## 4. Color philosophy

The palette has **four roles**, in this priority order:

1. **Neutrals (zinc scale)** carry the UI. Surfaces, text, borders, dividers — these are 90% of the screen.
2. **Brand primary (per tenant)** marks identity surfaces — sidebar, primary buttons, key links, focused states. Defaults to **`#0F172A` (slate-900)** for the Pipeline AI / NYSD tenant.
3. **Brand accent (per tenant)** marks the single most-important CTA per surface. Defaults to **`#0369A1` (sky-700)**.
4. **Semantic statuses** carry app meaning — never used decoratively:
   - `success` — green (#10B981)
   - `warning` — amber (#F59E0B)
   - `danger` — red (#EF4444)
   - `info` — blue (#3B82F6)

### Color rules
- **One primary CTA per screen.** Everything else is secondary (outline) or ghost.
- **Status colors mean status.** A green badge means "successful state", never "this is the new feature."
- **Per-tenant overrides only touch `--brand-primary` and `--brand-accent`.** Neutrals, semantic statuses, spacing, radius, typography are CONSTANT across tenants — this is what keeps the product feeling like one product.
- **Contrast minimum: WCAG AA (4.5:1 for body text).** AAA where feasible (7:1 for primary text on surface).
- **Dark mode is first-class.** Every token has a dark variant. Brand colors stay the same hue; neutrals invert.

---

## 5. Typography philosophy

**One family for the whole product: [Geist](https://vercel.com/font).**

| Use | Token | Tailwind class |
|---|---|---|
| All UI text | `var(--font-sans)` → Geist | `font-sans` |
| Data, code, numbers in tables | `var(--font-mono)` → Geist Mono | `font-mono` |
| Headings | `var(--font-sans)` → Geist (same family, heavier weight + tighter tracking) | `font-sans tracking-tight` |

### Why Geist
- Variable font (every weight, every width) → fewer network requests
- Designed for screens, optimised for tabular numerals
- Same family for headings and body → consistent rhythm
- Open-source, served via `next/font/google` — already loaded
- Reads as "engineering taste" (Vercel/Linear association)

### Type scale (8 sizes, mapped to specific roles)
| Role | Size | Weight | Tracking | Token |
|---|---|---|---|---|
| Meta / caption | 12px | 400 | normal | `text-meta` |
| Eyebrow (UPPERCASE) | 12px | 500 | wider | `text-eyebrow` |
| Body | 14px | 400 | normal | `text-body` |
| Card title | 14px | 600 | normal | `text-card-title` |
| Section header | 16px | 600 | normal | `text-section-header` |
| Page title | 20–24px | 700 | tight | `text-page-title` |
| Hero | 30–36px | 700 | tight | `text-hero` |
| KPI value | 24–30px | 700 | tight, tabular | `text-kpi-value` |

These tokens already exist in `globals.css @layer components`. Phase B will sweep the codebase to use them consistently.

---

## 6. Density

**Comfortable, never cramped, never wastefully airy.**

- Card internal padding: **16px** (`p-4`) on mobile, **24px** (`p-6`) on desktop.
- Stack siblings inside a card: `space-y-4`.
- Stack cards in a column: `space-y-6`.
- Page section gap: `gap-8` or `space-y-8`.
- Touch targets: minimum **44×44 px** for any interactive element on mobile.
- Input height: **44px** consistently — meets touch target on mobile, looks intentional on desktop.

---

## 7. How this layers with per-tenant branding

Pipeline AI is multi-tenant. Each organization can upload a logo and pick a primary + accent color via `/settings/branding`. The `BrandProvider` writes these to CSS variables (`--brand-primary`, `--brand-accent`) on `<html>`.

**This document describes the DEFAULT brand** (Polar Bear Agency / Pipeline AI), and the **structural tokens that are constant across tenants** (typography, spacing, radius, semantic statuses, neutral scale).

Tenants override:
- `--brand-primary` (sidebar, primary CTAs)
- `--brand-accent` (highlight CTAs, focus states)
- Logo (`logo_url`)
- Organization name (used where logo is absent)

Tenants do NOT override:
- Typography family or scale
- Neutral grey scale (zinc)
- Semantic status colors (success/warning/danger/info)
- Spacing scale
- Radius scale
- Shadow scale
- Motion durations

This split is what keeps every tenant feeling like the same product, while letting their brand show through where it matters.
