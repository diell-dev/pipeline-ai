'use client'

/**
 * Global Providers
 *
 * Wraps the app with:
 * 1. Auth session loader (fetches user + org on mount)
 * 2. Brand theme applier (CSS custom properties)
 * 3. Toast notifications (Sonner)
 */
import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useThemeBrand } from '@/hooks/use-theme-brand'
import { createClient } from '@/lib/supabase/client'
import type { User, Organization } from '@/types/database'

export function Providers({ children }: { children: React.ReactNode }) {
  const { theme, setSession, clearSession, setLoading } = useAuthStore()

  // Apply brand theme as CSS variables
  useThemeBrand(theme)

  // Load session on mount
  useEffect(() => {
    const supabase = createClient()

    async function loadSession() {
      setLoading(true)

      const { data: { user: authUser } } = await supabase.auth.getUser()

      if (!authUser) {
        clearSession()
        return
      }

      // Fetch the user profile with organization data
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()

      if (!profile) {
        clearSession()
        return
      }

      // Fetch the organization
      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', profile.organization_id)
        .single()

      if (!org) {
        clearSession()
        return
      }

      setSession(profile as User, org as Organization)
    }

    loadSession()

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === 'SIGNED_OUT') {
          clearSession()
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          loadSession()
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [setSession, clearSession, setLoading])

  return (
    <>
      {children}
      <Toaster position="top-right" richColors />
    </>
  )
}
