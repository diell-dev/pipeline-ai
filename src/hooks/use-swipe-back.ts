'use client'

/**
 * useSwipeBack — iOS-style edge-swipe-to-go-back (M2.5)
 *
 * Returns a ref to attach to the outermost wrapper of a detail page. The
 * hook watches for pointer-down within `edgeThreshold` (default 20px) of
 * the left edge, then tracks horizontal drag. The element translates with
 * the finger and a small backdrop tint appears under it. Release rules:
 *
 *   • Past `commitFraction` of viewport width (default 30%) → router.back()
 *   • Velocity ≥ `commitVelocity` (default 0.5 px/ms) → router.back()
 *   • Otherwise → spring back to origin (no navigation)
 *
 * Desktop disabled by default (the gesture doesn't make sense with a mouse
 * and Next's prefetched links already make back navigation instant).
 *
 * Implementation notes:
 *   • Uses Pointer Events, capturing the pointer on the wrapper so the
 *     drag survives finger lifts over child elements.
 *   • Bypasses the gesture if the touch starts on an interactive element
 *     (input, textarea, button, etc.) so form text-selection still works.
 *   • Does NOT preventDefault on touchmove unless the drag is meaningfully
 *     horizontal (>10px and angle <60deg) — vertical scroll still works.
 *   • Uses requestAnimationFrame to flush style updates, never block the
 *     pointer handler thread.
 */
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface UseSwipeBackOptions {
  /** Pixels from the left edge that count as "edge". Default 20. */
  edgeThreshold?: number
  /** Fraction of viewport width to commit (0..1). Default 0.3. */
  commitFraction?: number
  /** Min release velocity in px/ms. Default 0.5. */
  commitVelocity?: number
  /** Disable on screens wider than this px. Default 640. */
  desktopBreakpoint?: number
  /** Disable the gesture entirely (useful for opt-out by route). */
  disabled?: boolean
}

const TAG_OPT_OUT = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'])

export function useSwipeBack<T extends HTMLElement = HTMLDivElement>(
  options: UseSwipeBackOptions = {}
) {
  const {
    edgeThreshold = 20,
    commitFraction = 0.3,
    commitVelocity = 0.5,
    desktopBreakpoint = 640,
    disabled = false,
  } = options

  const ref = useRef<T | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    if (typeof window === 'undefined') return
    // Skip on desktop — the gesture is a mobile pattern.
    if (window.innerWidth > desktopBreakpoint) return

    let startX = 0
    let startY = 0
    let startTime = 0
    let currentX = 0
    let dragging = false
    let activated = false
    let pointerId: number | null = null
    let rafId: number | null = null

    const setTransform = (x: number) => {
      if (rafId != null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        el.style.transform = `translateX(${x}px)`
        // Subtle opacity fade on the underlying content as it slides off,
        // mirroring how iOS dims the prior screen behind the gesture.
        el.style.opacity = String(Math.max(0.6, 1 - x / window.innerWidth))
        rafId = null
      })
    }

    const resetStyles = () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      rafId = null
      // Animate back to origin with the same iOS curve as Vaul.
      el.style.transition =
        'transform 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 220ms cubic-bezier(0.32, 0.72, 0, 1)'
      el.style.transform = ''
      el.style.opacity = ''
      // Clear the transition after it finishes so subsequent drags don't
      // animate through their start position.
      window.setTimeout(() => {
        el.style.transition = ''
      }, 240)
    }

    const onPointerDown = (e: PointerEvent) => {
      // Only single-touch / primary mouse press.
      if (!e.isPrimary) return
      // Bail on touches that start on form elements (let them work normally).
      const target = e.target as HTMLElement | null
      if (target) {
        if (TAG_OPT_OUT.has(target.tagName)) return
        if (target.isContentEditable) return
      }
      // Only count touches starting at the leftmost edge.
      if (e.clientX > edgeThreshold) return

      startX = e.clientX
      startY = e.clientY
      currentX = 0
      startTime = e.timeStamp
      dragging = true
      activated = false
      pointerId = e.pointerId
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || pointerId !== e.pointerId) return

      const dx = e.clientX - startX
      const dy = e.clientY - startY

      // First-move decision: are we doing a horizontal drag or a scroll?
      if (!activated) {
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        // Wait until the user has moved meaningfully before activating.
        if (absDx < 10 && absDy < 10) return
        // If they're moving more vertically than horizontally, abandon
        // and let normal scroll happen.
        if (absDy > absDx) {
          dragging = false
          return
        }
        activated = true
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          /* not all targets support capture; ignore */
        }
      }

      // Only drag right (positive dx). Pulling left does nothing.
      currentX = Math.max(0, dx)
      setTransform(currentX)
    }

    const finish = (commit: boolean) => {
      dragging = false
      activated = false
      if (commit) {
        // Animate the page off-screen then call back(). The new page will
        // mount under our hand, so the perceived gesture is continuous.
        el.style.transition =
          'transform 200ms cubic-bezier(0.32, 0.72, 0, 1), opacity 200ms cubic-bezier(0.32, 0.72, 0, 1)'
        el.style.transform = `translateX(${window.innerWidth}px)`
        el.style.opacity = '0.4'
        window.setTimeout(() => {
          router.back()
          // After router.back the user will get the previous page; reset
          // our transform so if they swipe again the element is at origin.
          el.style.transition = ''
          el.style.transform = ''
          el.style.opacity = ''
        }, 180)
      } else {
        resetStyles()
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return
      if (!dragging && !activated) return
      const elapsed = e.timeStamp - startTime
      const velocity = currentX / Math.max(1, elapsed)
      const pastDistance = currentX >= window.innerWidth * commitFraction
      const fastEnough = velocity >= commitVelocity && currentX > 40
      finish(pastDistance || fastEnough)
      pointerId = null
    }

    const onPointerCancel = () => {
      if (!dragging) return
      finish(false)
      pointerId = null
    }

    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('pointermove', onPointerMove, { passive: true })
    el.addEventListener('pointerup', onPointerUp, { passive: true })
    el.addEventListener('pointercancel', onPointerCancel, { passive: true })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [
    edgeThreshold,
    commitFraction,
    commitVelocity,
    desktopBreakpoint,
    disabled,
    router,
  ])

  return ref
}
