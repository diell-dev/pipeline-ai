/**
 * Pipeline AI — Dynamic Theming System
 *
 * Each organization has its own brand colors and logo.
 * The theme is loaded from the organization record in the database
 * and applied as CSS custom properties on the root element.
 *
 * Default theme: Polar Bear Agency branding
 * - Primary: #05093d (Dark Navy)
 * - Accent: #00ff85 (Neon Green)
 * - Secondary: #0d06ff (Electric Blue)
 */

export interface BrandTheme {
  primaryColor: string     // Main brand color (sidebar, headers)
  accentColor: string      // Accent / CTA color (buttons, highlights)
  secondaryColor: string   // Secondary accent (badges, subtle highlights)
  logoUrl: string | null   // Organization logo URL
  organizationName: string // Shown when logo is missing
}

// Polar Bear Agency default theme
export const DEFAULT_THEME: BrandTheme = {
  primaryColor: '#05093d',
  accentColor: '#00ff85',
  secondaryColor: '#0d06ff',
  logoUrl: null,
  organizationName: 'Pipeline AI',
}

/**
 * Convert a hex color to HSL values for CSS custom properties.
 * shadcn/ui uses oklch but we need a simpler approach for dynamic theming.
 * We'll use HSL which is well-supported and easy to compute at runtime.
 */
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  // Remove # if present
  hex = hex.replace(/^#/, '')

  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

/**
 * Determine if a color is "light" (needs dark text) or "dark" (needs light text)
 */
function isLightColor(hex: string): boolean {
  const { l } = hexToHSL(hex)
  return l > 55
}

/**
 * Generate CSS custom properties from a brand theme.
 * These override the shadcn defaults to brand the dashboard.
 */
export function generateThemeCSS(theme: BrandTheme): Record<string, string> {
  const primary = hexToHSL(theme.primaryColor)
  const accent = hexToHSL(theme.accentColor)

  // Determine foreground colors based on brightness
  const primaryFg = isLightColor(theme.primaryColor) ? '0 0% 10%' : '0 0% 98%'
  const accentFg = isLightColor(theme.accentColor) ? '0 0% 10%' : '0 0% 98%'

  return {
    // Override shadcn's primary with the org's brand color
    '--brand-primary': theme.primaryColor,
    '--brand-accent': theme.accentColor,
    '--brand-secondary': theme.secondaryColor || theme.primaryColor,

    // Sidebar uses the primary brand color
    '--sidebar': `${primary.h} ${primary.s}% ${primary.l}%`,
    '--sidebar-foreground': primaryFg,
    '--sidebar-primary': `${accent.h} ${accent.s}% ${accent.l}%`,
    '--sidebar-primary-foreground': accentFg,
    '--sidebar-accent': `${primary.h} ${primary.s}% ${Math.min(primary.l + 8, 100)}%`,
    '--sidebar-accent-foreground': primaryFg,
    '--sidebar-border': `${primary.h} ${primary.s}% ${Math.min(primary.l + 12, 100)}%`,

    // Accent/CTA buttons use the accent color
    '--brand-btn-bg': theme.accentColor,
    '--brand-btn-fg': isLightColor(theme.accentColor) ? '#0a0a0a' : '#fafafa',
  }
}

/**
 * Apply theme CSS properties to a DOM element (usually document.documentElement)
 */
export function applyTheme(element: HTMLElement, theme: BrandTheme): void {
  const cssVars = generateThemeCSS(theme)
  Object.entries(cssVars).forEach(([key, value]) => {
    element.style.setProperty(key, value)
  })
}

/**
 * Build a BrandTheme from an organization database record
 */
export function themeFromOrganization(org: {
  primary_color: string
  accent_color: string
  secondary_color: string | null
  logo_url: string | null
  name: string
}): BrandTheme {
  return {
    primaryColor: org.primary_color || DEFAULT_THEME.primaryColor,
    accentColor: org.accent_color || DEFAULT_THEME.accentColor,
    secondaryColor: org.secondary_color || DEFAULT_THEME.secondaryColor,
    logoUrl: org.logo_url,
    organizationName: org.name,
  }
}
