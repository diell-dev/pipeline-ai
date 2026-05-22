'use client'

/**
 * BrandProvider
 *
 * Subscribes to the current organization in useAuthStore and injects
 * brand CSS variables on document.documentElement so every dashboard
 * surface — server-rendered or client — can reference the active org's
 * brand identity via `var(--brand-primary)` etc.
 *
 * Variables set on :root:
 *   --brand-primary / --brand-primary-rgb / --brand-primary-fg
 *   --brand-primary-50 ... --brand-primary-900
 *   --brand-accent / --brand-accent-rgb / --brand-accent-fg
 *
 * If no organization is loaded yet, falls back to DEFAULT_THEME so the
 * UI never flashes uncolored.
 */
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_THEME,
  getContrastingText,
  isValidHex,
  tintsFor,
  toRgbVar,
  type TintKey,
} from '@/lib/theme'

// All variable names we own — kept in one place so we can clean them
// up on unmount if needed.
const PRIMARY_TINT_VARS: Array<[TintKey, string]> = [
  ['50', '--brand-primary-50'],
  ['100', '--brand-primary-100'],
  ['200', '--brand-primary-200'],
  ['300', '--brand-primary-300'],
  ['400', '--brand-primary-400'],
  ['500', '--brand-primary-500'],
  ['600', '--brand-primary-600'],
  ['700', '--brand-primary-700'],
  ['800', '--brand-primary-800'],
  ['900', '--brand-primary-900'],
]

function applyBrandVars(primaryHex: string, accentHex: string) {
  const root = document.documentElement

  // Primary
  root.style.setProperty('--brand-primary', primaryHex)
  root.style.setProperty('--brand-primary-rgb', toRgbVar(primaryHex))
  root.style.setProperty('--brand-primary-fg', getContrastingText(primaryHex))

  const tints = tintsFor(primaryHex)
  PRIMARY_TINT_VARS.forEach(([key, varName]) => {
    root.style.setProperty(varName, tints[key])
  })

  // Accent
  root.style.setProperty('--brand-accent', accentHex)
  root.style.setProperty('--brand-accent-rgb', toRgbVar(accentHex))
  root.style.setProperty('--brand-accent-fg', getContrastingText(accentHex))
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const organization = useAuthStore((s) => s.organization)

  useEffect(() => {
    const primary =
      organization?.primary_color && isValidHex(organization.primary_color)
        ? organization.primary_color
        : DEFAULT_THEME.primaryColor
    const accent =
      organization?.accent_color && isValidHex(organization.accent_color)
        ? organization.accent_color
        : DEFAULT_THEME.accentColor

    applyBrandVars(primary, accent)
  }, [organization?.primary_color, organization?.accent_color])

  // Allow the branding settings page to push a live preview without
  // mutating the store. Listener applies the colors immediately; the
  // store-driven effect above will reconcile once the org row is saved.
  useEffect(() => {
    function handleUpdate(e: Event) {
      const detail = (e as CustomEvent<{ primary?: string; accent?: string }>).detail
      const primary =
        detail?.primary && isValidHex(detail.primary)
          ? detail.primary
          : organization?.primary_color && isValidHex(organization.primary_color)
            ? organization.primary_color
            : DEFAULT_THEME.primaryColor
      const accent =
        detail?.accent && isValidHex(detail.accent)
          ? detail.accent
          : organization?.accent_color && isValidHex(organization.accent_color)
            ? organization.accent_color
            : DEFAULT_THEME.accentColor

      applyBrandVars(primary, accent)
    }

    window.addEventListener('brand-preview', handleUpdate)
    window.addEventListener('organization-updated', handleUpdate)
    return () => {
      window.removeEventListener('brand-preview', handleUpdate)
      window.removeEventListener('organization-updated', handleUpdate)
    }
  }, [organization?.primary_color, organization?.accent_color])

  return <>{children}</>
}
