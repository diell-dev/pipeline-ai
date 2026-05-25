# Pipeline AI — Look & Feel Uplift Plan

**Drafted:** 2026-05-24
**Goal:** Move the app from "competent default-shadcn" → "distinctive product that feels expertly crafted." Plan-first; nothing changes until you approve.

**Skills that will drive the work:**
- `ckm:brand` — voice + visual identity sync
- `ckm:design-system` — 3-layer token architecture (primitive → semantic → component)
- `ckm:ui-styling` — shadcn + Tailwind patterns
- `ckm:design` — comprehensive (logos, icons, banners, mockups)
- `ckm:banner-design` — hero / promo surfaces
- `ui-ux-pro-max` — 161 palettes, 57 font pairings, 99 UX rules, anti-patterns

---

## Where we are now

- Generic shadcn defaults: zinc base, black-on-white, system fonts, basic shadows
- Per-tenant theme provider (Phase 1 of earlier design overhaul) — works for brand color but tokens aren't formalized
- Bottom nav on mobile (done)
- StatusBadge component shipped (not yet used everywhere)
- No real motion system — transitions are ad-hoc CSS
- No dark mode (need to confirm — assumed absent)
- Logo is a green "P" chip — placeholder feel
- No defined font pairing — system stack
- Empty states inconsistent (some pages have them, some don't)

The 25-finding UX sweep we just shipped fixed structural/correctness UX. This plan is the LAYER ABOVE that — the visual + emotional uplift.

---

## The plan — 8 phases

Ordered by dependency (A unblocks the rest) and within-tier by leverage.

### Phase A — Design system foundation (no visible change, unblocks everything)

**What:** Establish a documented 3-layer token system. Define the brand DNA. Pick a distinctive visual direction for Pipeline AI / NYSD default tenant.

**Tasks:**
- A1. Run `ui-ux-pro-max --design-system "field service SaaS trade industry modern professional"` to get a grounded recommendation (style, palette, fonts, effects)
- A2. Write `docs/brand-guidelines.md` (voice, palette, typography, logo usage)
- A3. Create `assets/design-tokens.json` with primitive → semantic → component layers
- A4. Generate `assets/design-tokens.css` (CSS vars consumed by Tailwind + components)
- A5. Wire tokens into `tailwind.config.ts` so utility classes use them
- A6. Document everything in `DESIGN_SYSTEM.md` at project root

**Visible change:** None. This is plumbing.
**Effort:** ~half a day with one agent.
**Approval needed:** Yes (palette + font pairing recommendations need your sign-off before propagating).

---

### Phase B — Visual identity uplift (the LOOK)

**What:** Apply the brand DNA. Typography pairing, color depth, semantic statuses, iconography discipline.

**Tasks:**
- B1. Swap system fonts → distinctive heading (e.g., Inter Tight / Geist / Bricolage Grotesque) + humanist body (Inter / Geist) — final picks driven by Phase A
- B2. Deepen color palette: brand primary, brand accent, semantic statuses (success / warning / danger / info), refined neutral scale
- B3. Tighten shadow scale (4 elevations max), radius tokens (sm/md/lg/full), opacity tokens for overlays
- B4. Sweep for emoji-as-system-icons (none should remain in nav/buttons; emojis OK inside equipment category content where they're data)
- B5. Replace `<Loader2 spin>` everywhere with shimmer skeletons matching content shape

**Visible change:** Yes — every page picks up new fonts + refined palette.
**Effort:** ~1 day, 1-2 agents in parallel (typography sweep + skeleton component build).
**Approval needed:** Final font + palette picks before B1-B2 land.

---

### Phase C — Component pass (the FEEL)

**What:** Refine the components you see every page. Tight visual consistency.

**Tasks:**
- C1. Button: icon-text vertical alignment, loading state with spinner that doesn't shift width, size scale (sm/md/lg), variant cleanup (filled / outline / ghost / link)
- C2. Card: standardize shadow, hover lift (subtle), padding scale, header treatment
- C3. Input + Select: focus rings, error states with red ring + inline message, helper text below, consistent height (44px to meet touch target)
- C4. Badge: migrate all status pills to StatusBadge across Jobs / Invoices / Proposals
- C5. Dialog: spring open animation, focus management, mobile sheet behavior
- C6. Reusable EmptyState component (icon + heading + description + CTA) — apply to clients, proposals, equipment list, schedule, etc.
- C7. KPI Card component — used by dashboard + finances, with optional sparkline + trend chip
- C8. PageHeader component — title + subtitle + breadcrumb + actions row — standardise across all pages

**Visible change:** Big. Every page gets tighter feel.
**Effort:** ~1.5-2 days, 2 agents in parallel (form components + display components).
**Approval needed:** Style direction (e.g., card hover behavior) reviewed via 1-2 mockups before committing.

---

### Phase D — Dashboard hero refresh

**What:** Right now dashboard = grid of cards. Make it feel like a product home, not a stats wall.

**Tasks:**
- D1. Welcome strip: personalised greeting + 2 most-relevant next actions (e.g., "Review 3 pending jobs" + "1 invoice overdue → mark paid")
- D2. KPI strip uses the new KPI Card component with sparklines + trend chips
- D3. Activity timeline component (replace the Quick Actions row at bottom) — recent jobs, invoices paid, equipment registered, with avatars
- D4. Equipment Lifecycle widget gets a small bar chart instead of progress bar (better viz)
- D5. Mobile dashboard: a single-column scrollable feed instead of 2-col grid (better thumb experience)

**Visible change:** Dashboard feels purpose-built instead of templated.
**Effort:** ~1 day, 1 agent.
**Approval needed:** Layout direction approved via mockup before build.

---

### Phase E — Public-facing surface polish

**What:** The surfaces your customers see (proposal sign, equipment scan landing) need to look marketing-grade, not internal-tool grade.

**Tasks:**
- E1. Login page: warmer auth experience — branded panel, value-prop strip, social proof if relevant
- E2. `/proposals/sign/[token]`: client-facing proposal sign experience — line items in a beautiful card, signature pad with affordance, success state with confetti or check animation
- E3. `/equipment/[qr]` public scan landing: tenant-branded, mobile-first, single-purpose ("Report an issue" CTA)
- E4. PDF email templates: branded header + footer (when email shipping is ready — defer until then)

**Visible change:** Major lift on the surfaces strangers see.
**Effort:** ~1 day, 1-2 agents.
**Approval needed:** Mockups before build for each of the 3 surfaces.

---

### Phase F — Motion + micro-interactions

**What:** Add Framer Motion (or unify CSS transitions) so the app FEELS responsive.

**Tasks:**
- F1. Install Framer Motion (or commit to CSS-only — pick one), add motion tokens (durations, easings, springs)
- F2. Page transition: subtle fade or slide between routes
- F3. List item entrance: 30-50ms stagger when lists load (jobs, invoices, equipment)
- F4. Dialog: spring open from trigger point (not just fade in)
- F5. Success states: brief check animation + toast (instead of just toast)
- F6. Button press: 0.97 scale on tap-down for primary CTAs
- F7. All animations respect `prefers-reduced-motion`

**Visible change:** App feels alive. Probably the highest "wow" per hour of work.
**Effort:** ~1 day, 1 agent.
**Approval needed:** Library choice (Framer Motion adds ~30kb).

---

### Phase G — Dark mode

**What:** Wire dark mode tokens, add toggle.

**Tasks:**
- G1. Add dark variants to all semantic tokens (Phase A must come first)
- G2. Dark mode toggle in user menu (top-right)
- G3. Persist preference (localStorage) + respect `prefers-color-scheme`
- G4. Audit all pages in dark mode for contrast issues, fix
- G5. Status pills, charts, KPI numbers all tested in dark

**Visible change:** New product surface. Most users will try it once even if they don't stick with it.
**Effort:** ~1 day, 1 agent.
**Approval needed:** Whether dark is a v1 ship or a v2 nice-to-have.

---

### Phase H — Brand assets

**What:** Logo, favicon, social cards, email-template artwork.

**Tasks:**
- H1. Logo refinement (current "P" green chip → real logomark/wordmark, probably commissioned or AI-generated via `ckm:design`)
- H2. Favicon set (16/32/192/512 + apple-touch-icon)
- H3. Social cards / OG images for the marketing site
- H4. Tenant logo upload UX polish (we have the upload, polish the affordance)

**Visible change:** Brand identity feels intentional.
**Effort:** Half a day, but design-direction-dependent.
**Approval needed:** Logo direction (clean wordmark vs symbol mark vs both). May want professional designer in the loop.

---

## Suggested sequencing

**Most-leverage path (recommended):** A → B → C → F → D → G → E → H

Reasoning: A unblocks B+C. B+C make every page look better immediately. F adds the "feel". D refines the most-visited page. G adds a popular feature. E polishes external surfaces (lower urgency until self-serve onboarding ships). H is biggest visual change but most subjective.

**Fastest visible impact (compromise):** A → B → C → F (~3-4 days total, ~70% of the visual lift, no marketing surfaces touched yet)

**Bare minimum to "look professional" (one-day sprint):** Just B (typography + palette refresh) + C1+C2+C6 (button + card + empty states). ~6 hours of agent work. Does not include design system foundation — risks inconsistency later.

---

## What I need from you to start

1. **Approve the overall direction** (or counter with what you want differently)
2. **Pick a phase set:** all 8, just A-D, just A-C, etc.
3. **Color/font preference signals:**
   - Vibe: "trustworthy/professional" (Stripe / Linear feel) vs "warm/approachable" (Notion / Cron feel) vs "field-service-rugged" (more saturated, work-boot feel)?
   - Any color you DON'T want (avoid red dominance because of warning meaning, avoid blue because too generic, etc.)?
   - Any reference apps you love the look of?
4. **Dark mode v1 or v2?**
5. **Brand assets:** want me to attempt the logo via AI generation, or defer to a real designer?

Once I have those, I'll fire Phase A and check back with concrete recommendations (palettes + font pairings) before propagating to the rest of the app.
