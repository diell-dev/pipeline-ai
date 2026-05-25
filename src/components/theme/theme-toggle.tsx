'use client'

/**
 * ThemeToggle — single-button light/dark switcher.
 *
 * Three states cycle: light → dark → system. The icon shows the *current
 * resolved* theme (sun for light, moon for dark), and the tooltip-style
 * title shows what the next click will switch to. This avoids the
 * dropdown-tax of next-themes' canonical example while still letting users
 * opt back into system mode.
 *
 * Persisted via the storageKey set in <ThemeProvider> (pipeline-ai:theme).
 * Respects prefers-color-scheme on first visit.
 *
 * Mounted in the user dropdown menu in src/components/layout/app-header.tsx.
 */
import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

const NEXT_LABEL: Record<string, string> = {
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
  system: 'Switch to light theme',
}

// useSyncExternalStore-based "isClient" hook — avoids the
// react-hooks/set-state-in-effect lint and skips a render compared to the
// usual useEffect+useState pattern. The server snapshot is always `false`,
// so the placeholder renders on the server and on the first client paint;
// after hydration React replaces it with the real toggle.
const subscribe = () => () => {}
const useIsClient = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const isClient = useIsClient()

  if (!isClient) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={className}
        aria-label="Toggle theme"
        suppressHydrationWarning
      >
        <Sun className="h-4 w-4" />
      </Button>
    )
  }

  const current = theme ?? 'system'
  const visualTheme = resolvedTheme ?? 'light'

  const Icon = current === 'system' ? Monitor : visualTheme === 'dark' ? Moon : Sun
  const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      title={NEXT_LABEL[current]}
      aria-label={NEXT_LABEL[current]}
      className={className}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
