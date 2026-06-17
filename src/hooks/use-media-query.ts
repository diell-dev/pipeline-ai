'use client'

/**
 * useMediaQuery — subscribe to a CSS media query and re-render when it flips.
 *
 * Built on `useSyncExternalStore` so:
 *   - The subscription model matches what the lint rule (and React itself)
 *     prefers for "read live value from external system."
 *   - No setState-in-effect cascade — the snapshot is read on every render
 *     and React only re-renders when the subscription fires.
 *   - SSR returns the server snapshot (`false`) and matches it on first
 *     client paint to avoid hydration mismatches.
 *
 * Common breakpoints (matched to Tailwind):
 *   (min-width: 640px)   sm  — desktop dialog vs mobile drawer
 *   (max-width: 639px)   inverse of sm — mobile-only effects
 *   (min-width: 768px)   md  — sidebar appears
 */
import { useCallback, useSyncExternalStore } from 'react'

function subscribe(query: string, callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia(query)
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', callback)
    return () => mql.removeEventListener('change', callback)
  }
  // Safari <14 fallback. `addListener` is deprecated but still present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = mql as any
  legacy.addListener(callback)
  return () => legacy.removeListener(callback)
}

function getSnapshot(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(query).matches
}

// Server snapshot: media queries can't be evaluated on the server, so we
// default to `false`. Components that need accurate first-paint behavior
// should render a mobile-safe fallback and let the first client render
// upgrade them.
function getServerSnapshot(): boolean {
  return false
}

export function useMediaQuery(query: string): boolean {
  const subscribeFn = useCallback(
    (cb: () => void) => subscribe(query, cb),
    [query]
  )
  const getSnapshotFn = useCallback(() => getSnapshot(query), [query])
  return useSyncExternalStore(subscribeFn, getSnapshotFn, getServerSnapshot)
}
