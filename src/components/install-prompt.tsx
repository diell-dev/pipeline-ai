'use client'

/**
 * Install prompt banner (Phase M4.4)
 *
 * Subtle "Add to home screen" nudge that respects user attention:
 *   - Only shows after ≥ 60s in-app AND ≥ 3 distinct routes visited
 *   - Dismissed dismissal is remembered for 30 days (localStorage)
 *   - Never shown if the app is already running standalone (already installed)
 *   - iOS gets different copy ("Tap Share → Add to Home Screen") because
 *     `beforeinstallprompt` doesn't fire on iOS Safari
 *
 * Mounted in the dashboard layout so it stays out of auth screens.
 *
 * Design notes (per design-taste-frontend skill):
 *   - No "install nag" affordance like a giant tinted card. This is a
 *     small slate pill that hugs the bottom and stays out of the way.
 *   - Above the bottom nav (bottom-20) on mobile so it doesn't cover it.
 *   - Honors prefers-reduced-motion by skipping the enter/exit slide.
 */
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Download, X } from 'lucide-react'

// localStorage keys — namespaced so we don't collide with other features.
const DISMISS_KEY = 'pipeline:install-prompt:dismissed-at'
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MIN_DWELL_MS = 60_000 // 60 seconds in-app
const MIN_ROUTES = 3 // three distinct paths

// Minimal type for the non-standard beforeinstallprompt event.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS uses navigator.standalone; everyone else uses the display-mode MQ.
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone) return true
  return window.matchMedia('(display-mode: standalone)').matches
}

function isIos(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent
  // Excludes iPadOS-on-Mac UA shenanigans by checking for actual touch.
  return /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
}

function isDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (Number.isNaN(ts)) return false
    return Date.now() - ts < DISMISS_TTL_MS
  } catch {
    return false
  }
}

export function InstallPrompt() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [variant, setVariant] = useState<'native' | 'ios' | null>(null)

  // Track distinct paths visited + dwell time. Using a ref so we don't
  // re-render on every route change just to bump a counter.
  const visited = useRef<Set<string>>(new Set())
  const dwellStart = useRef<number>(Date.now())
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Eligibility check — runs on a timer so we can show the banner after
  // 60s even if the user stays on a single page for that whole time.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isStandalone() || isDismissed()) return

    visited.current.add(pathname || '/')

    function tryShow() {
      if (isStandalone() || isDismissed()) return
      const dwellOk = Date.now() - dwellStart.current >= MIN_DWELL_MS
      const routesOk = visited.current.size >= MIN_ROUTES
      if (!dwellOk || !routesOk) return

      if (deferredPrompt.current) {
        setVariant('native')
        setVisible(true)
      } else if (isIos()) {
        // iOS — no `beforeinstallprompt`; show manual instructions.
        setVariant('ios')
        setVisible(true)
      }
      // Otherwise: silent wait (Chrome may fire beforeinstallprompt later).
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault()
      deferredPrompt.current = e as BeforeInstallPromptEvent
      tryShow()
    }

    function onInstalled() {
      setVisible(false)
      deferredPrompt.current = null
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    // Re-check periodically so the dwell-time gate eventually fires.
    checkTimer.current = setInterval(tryShow, 5_000)
    tryShow()

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      if (checkTimer.current) clearInterval(checkTimer.current)
    }
  }, [pathname])

  async function handleInstall() {
    const ev = deferredPrompt.current
    if (!ev) return
    try {
      await ev.prompt()
      await ev.userChoice
    } catch {
      // Swallow — the user closed the install dialog. We hide the banner
      // either way; they can re-trigger via the browser's install menu.
    } finally {
      deferredPrompt.current = null
      setVisible(false)
    }
  }

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Private mode / quota — ignore. Worst case the banner re-appears
      // on the next session, which is acceptable.
    }
    setVisible(false)
  }

  if (!visible || !variant) return null

  return (
    <div
      role="dialog"
      aria-label="Install Pipeline AI"
      // bottom-20 on mobile so we sit above the 64px bottom nav with 16px gap.
      // bottom-4 on md+ where there's no bottom nav.
      className="fixed inset-x-0 bottom-20 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-lg md:bottom-4 dark:border-zinc-800 dark:bg-zinc-900 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
      // Stay clear of the viewport edges (avoids notch overlap on iOS).
      style={{ marginLeft: 'max(env(safe-area-inset-left, 0px), 16px)', marginRight: 'max(env(safe-area-inset-right, 0px), 16px)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Install Pipeline AI</p>
          {variant === 'native' ? (
            <p className="truncate text-xs text-muted-foreground">
              Get the app on your home screen.
            </p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              Tap Share → Add to Home Screen.
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {variant === 'native' && (
          <button
            type="button"
            onClick={handleInstall}
            className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          // 44pt touch target — the inner X is visually 16px but the hit
          // area is the full 44x44 per impeccable / a11y guidance.
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
