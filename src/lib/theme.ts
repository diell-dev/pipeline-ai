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
 *
 * Public helpers (used by BrandProvider + branding settings page):
 *   - tintsFor(hex)         → 10-step tint/shade ramp keyed by 50..900
 *   - getContrastingText(hex) → '#fff' | '#0a0a0a' for legible foreground
 *   - isValidHex(s)         → validate hex strings (3 or 6 digit, with/without #)
 *   - toRgbVar(hex)         → 'r g b' triplet for use with rgb(var(--x) / <a>)
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

// ------------------------------------------------------------------
// Hex utilities
// ------------------------------------------------------------------

/**
 * Validate a hex color string. Accepts #RGB, #RRGGBB, RGB, RRGGBB.
 */
export function isValidHex(s: string): boolean {
  if (typeof s !== 'string') return false
  return /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim())
}

/**
 * Normalize a hex string to a 6-character #RRGGBB form (lowercase).
 * Returns null if the input is not valid.
 */
function normalizeHex(hex: string): string | null {
  if (!isValidHex(hex)) return null
  let h = hex.trim().replace(/^#/, '').toLowerCase()
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('')
  }
  return `#${h}`
}

/**
 * Parse a hex string to [r, g, b] in 0..255. Throws on invalid input.
 */
function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex)
  if (!norm) throw new Error(`Invalid hex color: ${hex}`)
  const v = norm.slice(1)
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

/**
 * Return a space-separated 'r g b' triplet for use in
 *   color: rgb(var(--brand-primary-rgb) / <alpha-value>)
 */
export function toRgbVar(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  return `${r} ${g} ${b}`
}

// ------------------------------------------------------------------
// HSL / contrast utilities
// ------------------------------------------------------------------

function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const [r255, g255, b255] = hexToRgb(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255

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

function hslToHex(h: number, s: number, l: number): string {
  const sFrac = s / 100
  const lFrac = l / 100

  const c = (1 - Math.abs(2 * lFrac - 1)) * sFrac
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lFrac - c / 2

  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (h >= 0 && h < 60) { r1 = c; g1 = x; b1 = 0 }
  else if (h < 120)     { r1 = x; g1 = c; b1 = 0 }
  else if (h < 180)     { r1 = 0; g1 = c; b1 = x }
  else if (h < 240)     { r1 = 0; g1 = x; b1 = c }
  else if (h < 300)     { r1 = x; g1 = 0; b1 = c }
  else                  { r1 = c; g1 = 0; b1 = x }

  const r = Math.round((r1 + m) * 255)
  const g = Math.round((g1 + m) * 255)
  const b = Math.round((b1 + m) * 255)

  const toHex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Relative luminance per WCAG 2.x.
 */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Return either '#fff' or '#0a0a0a' (near-black) for legible foreground
 * text against the given background hex.
 */
export function getContrastingText(bg: string): string {
  if (!isValidHex(bg)) return '#ffffff'
  // Threshold 0.5 — luminance above ⇒ light bg ⇒ use dark text.
  return relativeLuminance(bg) > 0.5 ? '#0a0a0a' : '#ffffff'
}

// Back-compat helper used elsewhere in the codebase.
function isLightColor(hex: string): boolean {
  return getContrastingText(hex) === '#0a0a0a'
}

// ------------------------------------------------------------------
// Tint ramp
// ------------------------------------------------------------------

/**
 * Generate a Tailwind-style 50..900 ramp from a single brand hex.
 * Step 500 is always exactly the input color.
 *
 * Lighter steps (50..400) keep hue/sat constant and raise lightness;
 * darker steps (600..900) keep hue/sat constant and lower lightness.
 * The spacing is chosen so each step is visually distinct without losing
 * the brand's character.
 */
export function tintsFor(hex: string): Record<TintKey, string> {
  const norm = normalizeHex(hex) ?? DEFAULT_THEME.primaryColor
  const { h, s, l } = hexToHSL(norm)

  // Target lightness values for each step. We bias toward whichever side
  // (light or dark) has more room so the ramp stays balanced regardless
  // of how light/dark the input color is.
  const lightHeadroom = 96 - l // distance to near-white
  const darkHeadroom = l - 8   // distance to near-black

  const lightSteps = [50, 100, 200, 300, 400]
  const darkSteps  = [600, 700, 800, 900]

  const result: Record<string, string> = { '500': norm }

  lightSteps.forEach((step, i) => {
    // 50 should be lightest, 400 closest to 500
    const t = (lightSteps.length - i) / lightSteps.length
    const newL = Math.min(96, Math.round(l + lightHeadroom * t))
    result[String(step)] = hslToHex(h, s, newL)
  })

  darkSteps.forEach((step, i) => {
    // 600 should be darkest-but-near 500, 900 the darkest overall
    const t = (i + 1) / darkSteps.length
    const newL = Math.max(4, Math.round(l - darkHeadroom * t))
    result[String(step)] = hslToHex(h, s, newL)
  })

  return result as Record<TintKey, string>
}

export type TintKey = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'

// ------------------------------------------------------------------
// Legacy theme CSS generator (kept for compatibility with old hook)
// ------------------------------------------------------------------

export function generateThemeCSS(theme: BrandTheme): Record<string, string> {
  const primary = hexToHSL(theme.primaryColor)
  const accent = hexToHSL(theme.accentColor)

  const primaryFg = isLightColor(theme.primaryColor) ? '0 0% 10%' : '0 0% 98%'
  const accentFg = isLightColor(theme.accentColor) ? '0 0% 10%' : '0 0% 98%'

  return {
    '--brand-primary': theme.primaryColor,
    '--brand-accent': theme.accentColor,
    '--brand-secondary': theme.secondaryColor || theme.primaryColor,

    '--sidebar': `${primary.h} ${primary.s}% ${primary.l}%`,
    '--sidebar-foreground': primaryFg,
    '--sidebar-primary': `${accent.h} ${accent.s}% ${accent.l}%`,
    '--sidebar-primary-foreground': accentFg,
    '--sidebar-accent': `${primary.h} ${primary.s}% ${Math.min(primary.l + 8, 100)}%`,
    '--sidebar-accent-foreground': primaryFg,
    '--sidebar-border': `${primary.h} ${primary.s}% ${Math.min(primary.l + 12, 100)}%`,

    '--brand-btn-bg': theme.accentColor,
    '--brand-btn-fg': isLightColor(theme.accentColor) ? '#0a0a0a' : '#fafafa',
  }
}

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
    primaryColor: isValidHex(org.primary_color) ? org.primary_color : DEFAULT_THEME.primaryColor,
    accentColor: isValidHex(org.accent_color) ? org.accent_color : DEFAULT_THEME.accentColor,
    secondaryColor:
      org.secondary_color && isValidHex(org.secondary_color)
        ? org.secondary_color
        : DEFAULT_THEME.secondaryColor,
    logoUrl: org.logo_url,
    organizationName: org.name,
  }
}
