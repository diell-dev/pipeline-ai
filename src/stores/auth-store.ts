'use client'

/**
 * Auth Store — Zustand
 *
 * Holds the current user, their organization, and brand theme.
 * Populated on login, available everywhere in the app.
 */
import { create } from 'zustand'
import type { User, Organization } from '@/types/database'
import type { BrandTheme } from '@/lib/theme'
import { themeFromOrganization, DEFAULT_THEME } from '@/lib/theme'
import { getTierConfig, type TierConfig } from '@/lib/tier-limits'
import { createClient } from '@/lib/supabase/client'

interface AuthState {
  // State
  user: User | null
  organization: Organization | null
  theme: BrandTheme
  tierConfig: TierConfig | null
  isLoading: boolean

  // Actions
  setSession: (user: User, organization: Organization) => void
  clearSession: () => void
  setLoading: (loading: boolean) => void
  updateOrganization: (org: Partial<Organization>) => void
  refreshOrganization: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  organization: null,
  theme: DEFAULT_THEME,
  tierConfig: null,
  isLoading: true,

  setSession: (user, organization) => {
    const theme = themeFromOrganization(organization)
    const tierConfig = getTierConfig(organization.tier)
    set({ user, organization, theme, tierConfig, isLoading: false })
  },

  clearSession: () => {
    set({
      user: null,
      organization: null,
      theme: DEFAULT_THEME,
      tierConfig: null,
      isLoading: false,
    })
  },

  setLoading: (isLoading) => set({ isLoading }),

  updateOrganization: (orgUpdate) => {
    const current = get().organization
    if (!current) return
    const updated = { ...current, ...orgUpdate }
    const theme = themeFromOrganization(updated)
    const tierConfig = getTierConfig(updated.tier)
    set({ organization: updated, theme, tierConfig })
  },

  /**
   * Re-fetch the current organization row and merge it into the store.
   * Call this after persisting org-level changes (branding, company info)
   * so BrandProvider and the rest of the UI pick up the new values
   * without a full page reload.
   */
  refreshOrganization: async () => {
    const current = get().organization
    if (!current) return
    const supabase = createClient()
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', current.id)
      .single()
    if (error || !data) {
      console.error('refreshOrganization failed:', error?.message)
      return
    }
    const org = data as Organization
    const theme = themeFromOrganization(org)
    const tierConfig = getTierConfig(org.tier)
    set({ organization: org, theme, tierConfig })
  },
}))
