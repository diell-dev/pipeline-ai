/**
 * Pipeline AI — Books API guard helper.
 *
 * Every /api/books/* route shares the same three-step entry check:
 *   1. Auth check via getApiUser().
 *   2. Tier check — org must have the `bookkeeping` feature on its tier.
 *   3. Permission check — `bookkeeping:view` for reads, `bookkeeping:edit`
 *      for writes, etc.
 *
 * This module centralizes those checks so individual route handlers
 * stay short and consistent.
 */
import { NextResponse } from 'next/server'

import { getApiUser, canAccessOrg } from '@/lib/api-auth'
import { hasPermission, type Permission } from '@/lib/permissions'
import { hasFeature } from '@/lib/tier-limits'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole, SubscriptionTier } from '@/types/database'

export interface BooksAuthSuccess {
  ok: true
  userId: string
  organizationId: string
  role: UserRole
  tier: SubscriptionTier
  supabase: SupabaseClient
}

export interface BooksAuthFailure {
  ok: false
  response: NextResponse
}

export type BooksAuth = BooksAuthSuccess | BooksAuthFailure

/**
 * Guard a books API route. Returns either:
 *   - { ok: true,  ...context } — caller continues with the supabase client
 *   - { ok: false, response }   — caller `return`s the response directly
 *
 * Usage:
 *   const guard = await requireBooksAccess('bookkeeping:edit')
 *   if (!guard.ok) return guard.response
 *   const { supabase, organizationId, userId } = guard
 */
export async function requireBooksAccess(
  required: Permission = 'bookkeeping:view'
): Promise<BooksAuth> {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return {
      ok: false,
      response: NextResponse.json({ error: auth.error }, { status: auth.status }),
    }
  }

  // Look up the org tier so we can gate the route to business+.
  const supabase = await createClient()
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, tier')
    .eq('id', auth.organizationId)
    .single<{ id: string; tier: SubscriptionTier }>()

  if (orgError || !org) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    }
  }

  if (!hasFeature(org.tier, 'bookkeeping')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Bookkeeping module not available on your plan' },
        { status: 403 }
      ),
    }
  }

  if (!hasPermission(auth.role, required)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Missing permission: ${required}` },
        { status: 403 }
      ),
    }
  }

  return {
    ok: true,
    userId: auth.userId,
    organizationId: auth.organizationId,
    role: auth.role,
    tier: org.tier,
    supabase,
  }
}

/**
 * Convenience wrapper for routes that load a row by id and need both
 * the books guard + a tenant-isolation check on the loaded row.
 */
export function assertOrgMatch(
  guard: BooksAuthSuccess,
  rowOrgId: string
): NextResponse | null {
  if (
    !canAccessOrg(
      {
        authenticated: true,
        userId: guard.userId,
        organizationId: guard.organizationId,
        role: guard.role,
      },
      rowOrgId
    )
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
