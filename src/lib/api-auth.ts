/**
 * API Route Authentication Helper
 *
 * Verifies the current user's session and role for API route handlers.
 * Uses the Supabase server client (anon key + user cookies) to get
 * the authenticated user, then looks up their role from the users table.
 */
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types/database'
import { hasPermission } from '@/lib/permissions'

// Re-export so API routes can import permission helpers from one place.
export { hasPermission }

interface AuthResult {
  authenticated: true
  userId: string
  organizationId: string
  role: UserRole
}

interface AuthError {
  authenticated: false
  error: string
  status: number
}

export type ApiAuth = AuthResult | AuthError

/**
 * Get the authenticated user from the current request cookies.
 * Returns user ID, organization ID, and role — or an error.
 */
export async function getApiUser(): Promise<ApiAuth> {
  try {
    const supabase = await createClient()

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) {
      return { authenticated: false, error: 'Not authenticated', status: 401 }
    }

    // Look up the user's role and org from the users table
    const { data: dbUser, error: dbError } = await supabase
      .from('users')
      .select('id, organization_id, role, is_active')
      .eq('id', authUser.id)
      .eq('is_active', true)
      .single()

    if (dbError || !dbUser) {
      return { authenticated: false, error: 'User not found or inactive', status: 403 }
    }

    return {
      authenticated: true,
      userId: dbUser.id,
      organizationId: dbUser.organization_id,
      role: dbUser.role as UserRole,
    }
  } catch {
    return { authenticated: false, error: 'Authentication failed', status: 500 }
  }
}

