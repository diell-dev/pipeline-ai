'use client'

/**
 * usePullToRefresh — native-feeling pull-to-refresh for list pages (M4.5)
 *
 * The hook returns:
 *   - `pullProps` to spread on a scroll container (or, when the container
 *     is `window`, the hook attaches its own listeners and you can spread
 *     `{}` on whatever wrapper you like)
 *   - `indicatorProps` describing the current pull state (distance, phase)
 *     so the caller can render a refresh indicator however they want
 *   - `PullIndicator` — a default indicator element if you don't want to
 *     build your own. Pre-styled for the Pipeline AI shell.
 *
 * Behavior (per emil-design-eng skill):
 *   - Only active when the scroll container is at top (scrollTop === 0)
 *     so we don't fight scroll inertia
 *   - Damping curve: distance = travel / (1 + travel / 240) so the more
 *     you pull the less the indicator moves (Apple-style rubber band)
 *   - Threshold: 70px → release-to-refresh state
 *   - Touch-only: skips on hover/precise-pointer devices
 *   - Respects prefers-reduced-motion — visual indicator is hidden and we
 *     skip the transform animation, but the gesture still triggers refresh
 *   - Multi-touch protection: ignores the gesture if more than one finger
 *     is on screen (so pinch-zoom doesn't accidentally refresh)
 *
 * The hook attaches passive: false touchmove listeners only when we've
 * confirmed the user is actually pulling down from the top — outside that
 * window we don't preventDefault and don't block normal scrolling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface UsePullToRefreshOptions {
  /** Called when the user releases past the threshold. Should return a
   *  promise — the indicator spins until it resolves. */
  onRefresh: () => Promise<void> | void
  /** Pixels you have to pull past for the gesture to trigger. */
  threshold?: number
  /** Disable the hook entirely (e.g. while another modal is open). */
  disabled?: boolean
}

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing'

interface PullState {
  phase: Phase
  distance: number
  threshold: number
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  // hover:none + pointer:coarse → phones, most tablets. We deliberately
  // don't trigger on hybrid devices with a mouse attached.
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function usePullToRefresh({
  onRefresh,
  threshold = 70,
  disabled = false,
}: UsePullToRefreshOptions) {
  // Container ref the caller spreads onto their scroll element. If they
  // don't attach it we fall back to window-scroll (document.scrollingElement).
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [state, setState] = useState<PullState>({
    phase: 'idle',
    distance: 0,
    threshold,
  })

  // Mutable per-gesture state — kept in refs so re-renders don't reset it.
  const startY = useRef<number | null>(null)
  const pulling = useRef(false)
  const fingers = useRef(0)
  const reducedMotion = useRef(false)
  const touchActive = useRef(false)
  const refreshingRef = useRef(false)

  // Cache feature-detection once. We don't bail out at hook-call-time
  // because SSR has no window — defer until the effect runs.
  useEffect(() => {
    touchActive.current = isTouchDevice()
    reducedMotion.current = prefersReducedMotion()
  }, [])

  const getScrollTop = useCallback((): number => {
    const el = containerRef.current
    if (el) return el.scrollTop
    if (typeof document === 'undefined') return 0
    return document.scrollingElement?.scrollTop ?? window.scrollY ?? 0
  }, [])

  // Damping: distance / (1 + distance / k). k=240 gives the right "fights
  // back the harder you pull" feel without ever clamping hard.
  const damp = useCallback((raw: number): number => {
    if (raw <= 0) return 0
    return raw / (1 + raw / 240)
  }, [])

  useEffect(() => {
    if (disabled) return
    if (typeof window === 'undefined') return
    if (!touchActive.current) return

    const target: EventTarget = containerRef.current ?? window

    function onTouchStart(e: Event) {
      const ev = e as TouchEvent
      fingers.current = ev.touches.length
      if (refreshingRef.current) return
      if (ev.touches.length !== 1) {
        startY.current = null
        return
      }
      // Only start tracking if we're at the top — otherwise this is a
      // normal scroll gesture and we don't interfere.
      if (getScrollTop() > 0) {
        startY.current = null
        return
      }
      startY.current = ev.touches[0].clientY
      pulling.current = false
    }

    function onTouchMove(e: Event) {
      const ev = e as TouchEvent
      if (startY.current === null) return
      if (ev.touches.length !== 1) {
        // Second finger landed → bail. Clear state so the user can pinch.
        startY.current = null
        pulling.current = false
        setState((s) => (s.phase === 'idle' ? s : { phase: 'idle', distance: 0, threshold }))
        return
      }
      const dy = ev.touches[0].clientY - startY.current
      if (dy <= 0) {
        // User is scrolling up — exit pull mode.
        if (pulling.current) {
          pulling.current = false
          setState({ phase: 'idle', distance: 0, threshold })
        }
        return
      }
      pulling.current = true
      // We're actively pulling — block default scroll so the page doesn't
      // bounce at the top. Must be a non-passive listener.
      if (ev.cancelable) ev.preventDefault()
      const dist = damp(dy)
      const phase: Phase = dist >= threshold ? 'ready' : 'pulling'
      setState({ phase, distance: dist, threshold })
    }

    function onTouchEnd() {
      if (!pulling.current) {
        startY.current = null
        return
      }
      pulling.current = false
      startY.current = null

      setState((s) => {
        if (s.phase === 'ready' && !refreshingRef.current) {
          refreshingRef.current = true
          Promise.resolve(onRefresh())
            .finally(() => {
              refreshingRef.current = false
              setState({ phase: 'idle', distance: 0, threshold })
            })
          return { phase: 'refreshing', distance: threshold, threshold }
        }
        return { phase: 'idle', distance: 0, threshold }
      })
    }

    // touchstart can be passive (we never preventDefault there).
    // touchmove must be non-passive so preventDefault works.
    target.addEventListener('touchstart', onTouchStart, { passive: true })
    target.addEventListener('touchmove', onTouchMove, { passive: false })
    target.addEventListener('touchend', onTouchEnd, { passive: true })
    target.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      target.removeEventListener('touchstart', onTouchStart)
      target.removeEventListener('touchmove', onTouchMove)
      target.removeEventListener('touchend', onTouchEnd)
      target.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [disabled, damp, getScrollTop, onRefresh, threshold])

  // Indicator element callers can drop in directly. Reduced-motion users
  // get no visual movement, but the gesture still works — this is per
  // impeccable / WCAG: don't animate, don't disable functionality.
  const PullIndicator = useMemo(() => {
    const Component = () => {
      if (state.phase === 'idle' && !refreshingRef.current) return null
      if (reducedMotion.current) {
        // Static "Refreshing…" pill, no motion. Only visible during the
        // actual refresh call (not during the pull itself).
        if (state.phase !== 'refreshing') return null
        return (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center pt-2">
            <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Refreshing…
            </span>
          </div>
        )
      }
      const progress = Math.min(1, state.distance / threshold)
      const rotation = progress * 360
      const opacity = Math.min(1, state.distance / (threshold * 0.6))
      return (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center"
          style={{
            transform: `translateY(${Math.min(state.distance, threshold + 16) - 32}px)`,
            opacity,
            // No transition during pull (one-to-one with finger). Snap
            // back happens via the idle re-render which removes the el.
          }}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md dark:bg-zinc-800">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-zinc-700 dark:text-zinc-200"
              style={{
                transform: `rotate(${rotation}deg)`,
                animation:
                  state.phase === 'refreshing'
                    ? 'pull-to-refresh-spin 0.8s linear infinite'
                    : undefined,
              }}
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                d="M12 4v4M12 4l3 3M12 4l-3 3"
              />
            </svg>
          </div>
          <style>{`
            @keyframes pull-to-refresh-spin {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )
    }
    Component.displayName = 'PullIndicator'
    return Component
  }, [state.distance, state.phase, threshold])

  return {
    /** Spread on the scroll container (or omit; we attach to window). */
    pullProps: { ref: containerRef },
    /** Raw state — useful if you want a custom indicator. */
    state,
    /** Ready-to-render indicator that lives at the top of the container. */
    PullIndicator,
  }
}
