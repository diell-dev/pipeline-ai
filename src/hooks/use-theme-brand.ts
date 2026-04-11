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

    // Cleanup: remove ALL custom properties set by generateThemeCSS
    return () => {
      const el = document.documentElement
      const vars = [
        '--brand-primary', '--brand-accent', '--brand-secondary',
        '--sidebar', '--sidebar-foreground', '--sidebar-primary',
        '--sidebar-primary-foreground', '--sidebar-accent',
        '--sidebar-accent-foreground', '--sidebar-border',
        '--brand-btn-bg', '--brand-btn-fg',
      ]
      vars.forEach((v) => el.style.removeProperty(v))
    }
  }, [theme])
}
