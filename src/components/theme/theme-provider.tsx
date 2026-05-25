'use client'

/**
 * ThemeProvider — Pipeline AI dark/light theme provider.
 *
 * Thin wrapper over next-themes. It writes `class="dark"` on <html> when
 * dark mode is active, persists the choice to localStorage under
 * `pipeline-ai:theme`, and respects `prefers-color-scheme` on first visit.
 *
 * Hooks into the Phase B design-token system: all surfaces, text, borders,
 * status colors, and shadows have dark variants in assets/design-tokens.css
 * via the `.dark, [data-theme='dark']` selector. Components don't need to
 * be refactored — they pick up the new values automatically because they
 * reference semantic tokens (--surface, --text-primary, etc.).
 *
 * Brand colors (--brand-primary, --brand-accent) stay the same hex across
 * light and dark by design. BrandProvider continues to set them at runtime
 * per tenant — this provider doesn't touch brand vars.
 */
import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="pipeline-ai:theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
