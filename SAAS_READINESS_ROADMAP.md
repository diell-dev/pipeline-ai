# Pipeline AI — Path from MVP to Real SaaS

**As-of:** 2026-05-23 (after fresh audit pass + equipment category cleanup)
**Audience:** Diell (PBA) + Bogdan (NYSD partner)

This is the punch-list of what's missing for Pipeline AI to go from "demo-grade product that works for Bogdan's NYSD" to "production B2B SaaS that strangers can sign up for, pay for, and rely on."

It's ranked by leverage, not by line-count. Each item has: what it is, why it matters, rough effort.

---

## Tier 0 — MUST do before public launch (1-2 months)

### 1. Self-serve onboarding
**What:** A sign-up flow that takes a new org from `/signup` → first user invited → first client added → first job created, with no manual super-admin handholding. Today an org is created by hand in Supabase. Without self-serve, no one can sign up.
**Why:** This is the gate between "demo" and "SaaS." Without it the only way to acquire a customer is calling Bogdan.
**Effort:** Medium — sign-up page, org creation flow, email verification, first-run wizard, sensible defaults seed.

### 2. Billing & subscription management
**What:** Stripe Subscriptions (different from Stripe Connect — that's for client payments). Per-org subscription, monthly billing, tier-based feature gating (we have `tier-limits.ts` but it's not enforced end-to-end), free trial, grace period for failed payment, cancellation flow.
**Why:** No revenue without this.
**Effort:** Large — pricing page, checkout, customer portal, webhook handling for subscription events, gating UI for paywalled features, dunning emails.

### 3. Error tracking + monitoring
**What:** Sentry (or similar) wired into the Next.js app for client + server errors. Vercel Analytics for performance. Some kind of uptime ping (BetterUptime, UptimeRobot).
**Why:** Right now if a page throws on Bogdan's phone in a basement, you don't know until he texts you. Doesn't scale past one customer.
**Effort:** Small — install Sentry SDK, configure DSN, set up alerts.

### 4. Legal pages
**What:** Terms of Service, Privacy Policy, Cookie consent (if EU traffic), DPA template for enterprise prospects.
**Why:** Stripe won't let you accept payments without ToS + Privacy. Required by law in many jurisdictions.
**Effort:** Small if you use a generator (Termly, Iubenda) — $30-100/yr. Large if a lawyer drafts them.

### 5. Production-grade backups + DR plan
**What:** Verify Supabase point-in-time recovery is on (it's a paid feature). Document the restore procedure. Test it once on a branch.
**Why:** Customer data loss = company-ending event.
**Effort:** Tiny — Supabase backups are usually one-click, just verify and document.

### 6. Support channel
**What:** A way for users to reach you when stuck. Even just `support@pipeline-ai.app` going to an inbox you check. Better: in-app help widget (Intercom, Crisp, Plain). Best: in-app + docs site + FAQ.
**Why:** Without support, churn is brutal — users hit a wall and leave silently.
**Effort:** Small for email-only; medium for in-app widget.

---

## Tier 1 — Within first 3 months of launch

### 7. Marketing site
**What:** Public-facing `pipeline-ai.app` (or similar) with pricing, features, demo video, lead capture, customer testimonials. Currently the URL goes straight to `/login`.
**Why:** No one finds you without a website. SEO + paid ads have nowhere to land.
**Effort:** Medium — separate Next.js project, copy + design, hosting.

### 8. Mobile experience hardening (PWA + offline)
**What:** Make the responsive web app installable as a PWA (add manifest + service worker). Field techs in basements with no signal need offline-capable inspection forms + sync-on-reconnect. Add push notifications via web push API.
**Why:** Field techs ARE the user. If the app doesn't work in their actual conditions, they won't use it.
**Effort:** Medium for PWA shell. Large for proper offline sync (offline-first inspection drafts, conflict resolution).

### 9. Permissions + 2FA + SSO
**What:**
- Custom roles beyond the current owner/admin/dispatcher/tech_lead/tech/client
- 2FA via TOTP (Google Authenticator, Authy)
- Optional SSO via Google / Microsoft for enterprise prospects
**Why:** Security table-stakes. Larger customers will require all three.
**Effort:** Medium for custom roles (we have permissions infrastructure already). Medium for 2FA (Supabase Auth has this built in, just needs UI). Large for true SSO.

### 10. Notification system
**What:**
- In-app notification center (bell icon top-right — we have the bell, no center behind it)
- Email digests (daily / weekly) with user-controlled cadence
- SMS for urgent items via Twilio (job assigned, schedule changed, payment overdue)
- Per-user preferences ("don't email me about scheduled jobs", etc.)
**Why:** Users won't check the dashboard 5x/day. Notifications drive engagement.
**Effort:** Medium-large.

### 11. Data import from competitors
**What:** CSV import wizard for clients, sites, equipment, past jobs/invoices. Templates for migrating from ServiceTitan, Housecall Pro, Jobber.
**Why:** Switching cost is real. If a tradesman has 10 years of customer history in another system, they won't move without an import path.
**Effort:** Medium-large per source system, but a generic CSV import covers 80% of cases.

### 12. Mobile-friendly tech app polish
**What:** Audit every page on a phone in the dark in the rain. Things that matter:
- Tap targets ≥48px
- Big primary CTAs at thumb-reach
- Bottom nav is a good start (you have this)
- Inspection forms one-screen-at-a-time, not scroll-fest
- Photo upload with camera fallback
- Voice notes for tech-in-attic scenarios
**Effort:** Medium — UX-driven pass through every key tech screen.

---

## Tier 2 — Within first 6 months

### 13. Integrations marketplace
**What:**
- QuickBooks Online sync (invoices + payments) — table stakes for trades
- Google / Outlook calendar sync (tech availability)
- Twilio for SMS
- Zapier integration (lets users wire to anything else)
- Maps & routing (Google Maps for tech routing, Mapbox alternative)
**Why:** Trades businesses live in QuickBooks. Without QuickBooks integration, you're a non-starter for most established shops.
**Effort:** Each integration is medium. Build the integration framework first, then ship one at a time.

### 14. Reporting + custom report builder
**What:** Currently you have a dashboard with fixed widgets. Real SaaS needs:
- Custom report builder (drag fields, filter, group, export to PDF/CSV)
- Scheduled reports (email weekly summary to owner)
- Common templates (revenue by tech, revenue by service category, customer aging, equipment service due)
**Effort:** Large.

### 15. Customer signature + photo evidence
**What:** Tech finishes job → customer signs on phone → photos before/after → signed PDF auto-generated and emailed to customer.
**Why:** Reduces disputes, looks professional, required by some commercial customers.
**Effort:** Medium — signature capture, PDF generation (already have docx/pdf skills), photo storage.

### 16. Workflow automation engine
**What:** "When job is completed → create draft invoice → if invoice unpaid for 30 days → send dunning email."  No-code rule builder for org admins.
**Why:** Reduces manual work, makes the platform stickier.
**Effort:** Large.

### 17. AI features (you have some — push further)
**What:**
- You have AI manufacturer lookup, AI tech-notes-to-invoice. Push it further.
- Voice-to-text for tech notes
- Auto-categorize jobs by photos
- Predictive maintenance (equipment lifecycle data → predicted failure)
- AI scheduling suggestions (next 7 days routes by tech/skill/location)
**Effort:** Each feature is medium. Anthropic + OpenAI APIs make most of this fast to prototype.

### 18. Compliance posture
**What:**
- GDPR: data export endpoint, data deletion endpoint, cookie consent
- SOC 2 (if going enterprise): security policies, audit log, encryption at rest
- HIPAA (if anyone in medical-adjacent trades): BAA with Supabase
**Why:** Required to sell to bigger customers.
**Effort:** Medium for GDPR basics. Large for SOC 2 (6-12 months process).

---

## Tier 3 — When you have product-market fit

### 19. Native mobile apps
**What:** iOS + Android via React Native or Capacitor wrapping the web app. App store presence boosts credibility.
**Effort:** Large.

### 20. Multi-language support
**What:** i18n framework (next-intl), Spanish for US Latino tech workforce, possibly other languages.
**Effort:** Medium for framework, ongoing for translations.

### 21. Vertical-specific modules
**What:** HVAC has different needs than plumbing has different needs than electrical. Build vertical packages with pre-configured categories, checklists, inspection forms, compliance reports.
**Effort:** Each vertical is large.

### 22. Partner / reseller program
**What:** Other agencies (like PBA) reselling Pipeline AI to their clients with white-label branding (you have per-tenant branding — extend it).
**Why:** Scales acquisition without scaling sales team.
**Effort:** Medium-large.

### 23. Public API + webhooks
**What:** Documented REST or GraphQL API so customers can build their own integrations. Webhook delivery for job/invoice/payment events.
**Effort:** Medium-large.

---

## Things that are NOT priorities (worth saying out loud)

- **Real-time collaboration / Figma-style cursors** — overkill for trades software.
- **Microservices architecture** — Next.js + Supabase will scale to thousands of orgs. Don't refactor until forced to.
- **Building your own auth** — Supabase Auth covers SSO, 2FA, magic links, etc.
- **Chasing every shiny integration** — Pick 3 that 80% of customers ask for (QuickBooks, calendar, Twilio).
- **AI everywhere** — the value is in the boring parts: scheduling, invoicing, dispatch. AI is the cherry on top.

---

## Suggested 90-day sequence (concrete)

**Month 1 (Foundation):**
- Sentry + uptime monitoring (week 1)
- ToS + Privacy + cookie consent (week 1)
- Verify backups + document restore (week 1)
- Marketing site v0 (week 2-3)
- Self-serve onboarding flow (week 3-4)

**Month 2 (Revenue):**
- Stripe Subscriptions + tier gating (week 5-6)
- In-app support widget + basic docs (week 7)
- 2FA via Supabase Auth UI (week 7)
- PWA manifest + offline shell (week 8)

**Month 3 (Stickiness):**
- QuickBooks integration MVP (week 9-10)
- Notification system (in-app + email) (week 11)
- CSV import for clients/sites/equipment (week 12)

After 90 days: launch publicly, start charging, iterate on what users actually ask for.

---

## What I'd push back on

If Bogdan is your only customer for the foreseeable future, **don't build all this**. Tier 0 + maybe Tier 1 items 7 & 8 (marketing site + mobile polish) are enough to acquire customer #2 through #20. The rest can wait until churn/signup data tells you where to invest.

The biggest unknown is whether NYSD use is making the product better for other trades shops, or whether you're slowly building a custom tool for Bogdan. The former is a SaaS; the latter is consulting work with a recurring-revenue label.

A check every 2 months: would a tradesman who has never met Bogdan or Diell sign up, pay, and stay? If yes, you're a SaaS. If no, you're consulting.
