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
}))
