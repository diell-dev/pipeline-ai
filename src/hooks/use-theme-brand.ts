'use client'

/**
 * Hook to apply brand theme to the page.
 * Reads the organization's branding and applies CSS custom properties.
 */
import { useEffect } from 'react'
import { applyTheme, type BrandTheme, DEFAULT_THEME } from '@/lib/theme'

export function useThemeBrand(theme: BrandTheme | null) {
  useEffect(() => {
    const activeTheme = theme || DEFAULT_THEME
    applyTheme(document.documentElement, activeTheme)

    // Cleanup: remove custom properties when unmounting
    return () => {
      const el = document.documentElement
      el.style.removeProperty('--brand-primary')
      el.style.removeProperty('--brand-accent')
      el.style.removeProperty('--brand-secondary')
      el.style.removeProperty('--brand-btn-bg')
      el.style.removeProperty('--brand-btn-fg')
    }
  }, [theme])
}
