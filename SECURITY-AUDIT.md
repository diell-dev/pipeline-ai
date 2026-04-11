# Security Audit Report

**Date:** 2026-04-11
**Scope:** Full codebase — `/pipeline-ai/src/**` and `/pipeline-ai/supabase/**`
**Stack:** Next.js 16.2.3, React 19, TypeScript, Supabase (Auth + PostgreSQL + RLS), Zustand, Tailwind CSS v4

## Summary

The Pipeline AI codebase has a solid security foundation (Supabase Auth, RLS on all tables, no hardcoded secrets, no XSS vectors). However, three **critical** privilege escalation vulnerabilities were found in the PostgreSQL RLS policies, plus several medium-severity gaps in rate limiting, error disclosure, and security headers. Zero dependency vulnerabilities (`npm audit` clean).

**Counts:** 3 Critical, 1 High, 3 Medium, 2 Low

## Remediation Priority

Fix in this order:
1. **User self-escalation via RLS gap** (Critical) — Any user can make themselves super_admin
2. **Organization tier tampering** (Critical) — Any owner can upgrade their subscription tier for free
3. **Organization field tampering** (Critical) — Owners can modify billing fields directly
4. **Missing rate limiting on login** (High) — Brute force vulnerability
5. **Missing Content-Security-Policy header** (Medium)
6. **Error messages may leak internal state** (Medium)
7. **Env var non-null assertions** (Medium)

This ordering matters because the privilege escalation bugs enable everything else — an attacker who becomes super_admin has access to all data across all orgs.

---

## Findings

### CRITICAL-01 — User Self-Escalation via RLS Policy Gap

**File:** `supabase/migrations/001_initial_schema.sql` (line 346-348)
**OWASP:** A01:2025 — Broken Access Control

**Description:** The "Users can update own profile" RLS policy allows any authenticated user to UPDATE their own row with NO column-level restrictions. PostgreSQL RLS is row-level only — it cannot restrict which columns are modified. This means a field_tech user can execute:

```sql
UPDATE users SET role = 'super_admin' WHERE id = auth.uid();
```

This grants full access to the entire system including all organizations' data (via the super_admin role in the permission system).

A user could also switch organizations:
```sql
UPDATE users SET organization_id = 'b0000000-0000-0000-0000-000000000001' WHERE id = auth.uid();
```

**Vulnerable code:**
```sql
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
```

**Fixed code:** Added a BEFORE UPDATE trigger that prevents users from modifying their own `role`, `organization_id`, or `is_active` fields:

```sql
CREATE OR REPLACE FUNCTION prevent_user_self_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Cannot change your own role';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change your own organization';
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Cannot change your own active status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Verification:** After applying the trigger, attempt:
```sql
-- As an authenticated user via Supabase client:
const { error } = await supabase.from('users').update({ role: 'super_admin' }).eq('id', userId)
// Should return error: "Cannot change your own role"
```

---

### CRITICAL-02 — Organization Tier Tampering

**File:** `supabase/migrations/001_initial_schema.sql` (line 328-332)
**OWASP:** A01:2025 — Broken Access Control

**Description:** The "Owners can update own org" RLS policy allows owners to modify ANY field on their organization, including `tier`, `max_users`, `stripe_customer_id`, and other billing fields. An owner could upgrade from 'basic' to 'business' tier without paying:

```sql
UPDATE organizations SET tier = 'business', max_users = 999, max_ai_generations_per_month = 0
WHERE id = auth.user_org_id();
```

**Fixed code:** Added a BEFORE UPDATE trigger that blocks changes to billing/tier fields from authenticated users. Only the service_role key (used by server-side billing logic) can modify these fields.

**Verification:**
```sql
-- As authenticated owner:
const { error } = await supabase.from('organizations').update({ tier: 'business' }).eq('id', orgId)
// Should return error: "Subscription tier can only be changed through the billing system"
```

---

### CRITICAL-03 — Organization Billing Field Manipulation

**File:** `supabase/migrations/001_initial_schema.sql` (line 328-332)
**OWASP:** A01:2025 — Broken Access Control

**Description:** Same root cause as CRITICAL-02. An owner could set `stripe_customer_id` to another customer's Stripe ID, potentially receiving their invoices or subscription status. Or set `storage_limit_gb` to bypass storage limits.

**Fixed code:** Same trigger as CRITICAL-02 — `protect_org_billing_fields()` blocks all billing field changes from authenticated users.

---

### HIGH-01 — Missing Rate Limiting on Login

**File:** `src/app/(auth)/login/page.tsx`
**OWASP:** A07:2025 — Authentication Failures

**Description:** The login form submits directly to Supabase Auth with no rate limiting. While Supabase has some built-in rate limiting on their hosted service, it's generous (many attempts per minute). For a SaaS app handling sensitive financial data, additional client-side throttling and server-side rate limiting should be implemented.

An attacker could script rapid credential stuffing attacks against known user emails.

**Recommendation:** Implement rate limiting at the API route level. This should be done when API routes are built (Phase 2). For now, Supabase's built-in rate limiting provides baseline protection. Consider adding:
- Client-side: Disable submit button for 2s after failed attempt, exponential backoff
- Server-side: Rate limit by IP using Vercel Edge Middleware or Upstash Redis

**Status:** Documented for Phase 2 implementation.

---

### MEDIUM-01 — Missing Content-Security-Policy Header

**File:** `next.config.ts`
**OWASP:** A02:2025 — Security Misconfiguration

**Description:** Security headers were added (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) but Content-Security-Policy (CSP) is missing. CSP is the strongest defense against XSS attacks. Without it, if an XSS vector is introduced in future development, there's no defense-in-depth.

**Recommendation:** Add a CSP header. For a Next.js + Supabase app:
```
default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' *.supabase.co data:; connect-src 'self' *.supabase.co;
```

Note: `unsafe-inline` for scripts is needed for Next.js. A nonce-based CSP is better but requires more setup. Documenting for Phase 2.

---

### MEDIUM-02 — Environment Variable Non-Null Assertions

**Files:** `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`
**OWASP:** A10:2025 — Mishandling of Exceptional Conditions

**Description:** All three Supabase client files use TypeScript non-null assertions (`!`) on environment variables:
```typescript
process.env.NEXT_PUBLIC_SUPABASE_URL!
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
```

If these env vars are missing (misconfigured deployment, deleted .env.local), the app crashes with an unhelpful runtime error. In production, this could expose internal paths or stack traces depending on error handling.

**Fixed code:** Added validation with clear error messages.

---

### MEDIUM-03 — Supabase Anon Key Used in Middleware

**File:** `src/lib/supabase/middleware.ts` (line 16)
**OWASP:** A04:2025 — Cryptographic Failures

**Description:** The middleware uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` which is the public anon key. This is correct and expected for Supabase's design (the anon key is meant to be public, with RLS providing security). However, ensure the service_role key is NEVER exposed in client-side code. The current codebase correctly only uses the anon key.

**Status:** No action needed. Verified correct.

---

### LOW-01 — Predictable Seed Organization UUIDs

**File:** `supabase/migrations/001_initial_schema.sql` (lines 484, 499)
**OWASP:** A04:2025 — Cryptographic Failures

**Description:** Seed data uses predictable UUIDs (`a0000000-0000-0000-0000-000000000001`). While not directly exploitable (RLS prevents cross-org access), predictable IDs make IDOR attacks easier if any authorization check is ever missed.

**Recommendation:** Use `uuid_generate_v4()` for production seed data. These predictable IDs are acceptable for development/testing only.

---

### LOW-02 — Dead Link to Forgot Password Page

**File:** `src/app/(auth)/login/page.tsx` (line 94)

**Description:** The login page links to `/forgot-password` which doesn't exist as a route. This will show a 404 error. While not a security vulnerability, it could be used in social engineering if an attacker creates a phishing page that mimics this flow.

**Recommendation:** Either create the forgot-password page or remove the link until it's implemented.

---

## Supply Chain & Dependency Check

```
$ npm audit
found 0 vulnerabilities
```

All dependencies are at their latest versions within semver ranges. No known CVEs.

**Key dependencies verified:**
- next@16.2.3 — latest stable
- @supabase/supabase-js@2.103.0 — latest
- @supabase/ssr@0.10.2 — latest
- react@19.2.4 — pinned, stable
- zod@4.3.6 — latest (v4 is new, stable)

No transitive dependency concerns identified.

---

## Fixes Applied

| File | Change |
|------|--------|
| `supabase/migrations/001_initial_schema.sql` | Added `prevent_user_self_escalation()` trigger to block role/org changes on self-update |
| `supabase/migrations/001_initial_schema.sql` | Added `protect_org_billing_fields()` trigger to block tier/billing changes from authenticated users |
| `src/lib/supabase/client.ts` | Added env var validation with clear error messages |
| `src/lib/supabase/server.ts` | Added env var validation with clear error messages |
| `src/lib/supabase/middleware.ts` | Added env var validation with clear error messages |
| `next.config.ts` | Security headers already added in Audit #2 (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) |

---

## Recommendations

### Immediate (before launch)
- Set up Supabase Auth email confirmation (prevent account enumeration)
- Configure Supabase Auth password policy (minimum length, complexity)
- Add rate limiting on login endpoint (Vercel Edge + Upstash Redis)

### Short-term (within first sprint)
- Implement Content-Security-Policy header with nonce-based script allowlisting
- Add CSRF protection for any server actions / API routes
- Set up Supabase Auth audit logging
- Create the forgot-password page or remove the dead link

### Medium-term
- Add input validation (Zod schemas) on all form submissions before they reach the database
- Implement API route rate limiting per-user and per-IP
- Set up automated dependency scanning in CI (GitHub Dependabot or Snyk)
- Add secret scanning to prevent accidental credential commits (GitHub secret scanning or git-secrets)

### AI Integration (when Claude API is added)
- Never include user-supplied content directly in system prompts without sanitization
- Validate and sanitize all LLM output before rendering or using in queries
- Implement output token limits to prevent resource exhaustion
- Log all AI interactions for audit trail
