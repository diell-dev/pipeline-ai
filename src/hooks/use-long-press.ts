'use client'

/**
 * useLongPress — fire a callback after the user holds for ≥ duration ms
 * (Phase M4.7 — currently a stub awaiting per-row context menu plumbing)
 *
 * Returns pointer event handlers to spread on a row. Cancels the
 * long-press if the user lifts the finger early or drags too far.
 *
 * Status: BUILT but not yet wired into the list rows. Wiring requires
 * deciding which existing dropdown/menu to surface per row type
 * (invoices have a 3-dot menu via the Mark Paid / Void buttons; jobs and
 * equipment don't have a context menu defined yet). Rather than invent
 * one — out of scope for the mobile gesture pass — we leave the hook
 * available for the next phase and note the TODO at each list page.
 *
 * Skips on non-touch devices so desktop right-click and existing hover
 * behaviors keep working.
 */
import { useCallback, useEffect, useRef } from 'react'

interface UseLongPressOptions {
  onLongPress: (e: PointerEvent) => void
  /** Hold duration in ms. iOS native long-press is ~500ms. */
  duration?: number
  /** Distance in px the finger can drift before we cancel. */
  cancelOnMove?: number
}

const TOUCH_DEVICE_QUERY = '(hover: none) and (pointer: coarse)'

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(TOUCH_DEVICE_QUERY).matches
}

export function useLongPress({
  onLongPress,
  duration = 500,
  cancelOnMove = 10,
}: UseLongPressOptions) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const fired = useRef(false)
  const touch = useRef(false)

  useEffect(() => {
    touch.current = isTouchDevice()
  }, [])

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!touch.current) return
      if (e.pointerType !== 'touch') return
      fired.current = false
      startX.current = e.clientX
      startY.current = e.clientY
      const native = e.nativeEvent
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress(native)
      }, duration)
    },
    [duration, onLongPress]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!timer.current) return
      const dx = Math.abs(e.clientX - startX.current)
      const dy = Math.abs(e.clientY - startY.current)
      if (dx > cancelOnMove || dy > cancelOnMove) clear()
    },
    [cancelOnMove, clear]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      clear()
      // If we already fired the long-press, suppress the synthetic click
      // that would otherwise follow on mobile Safari.
      if (fired.current) e.preventDefault()
    },
    [clear]
  )

  const onPointerCancel = useCallback(() => clear(), [clear])
  const onPointerLeave = useCallback(() => clear(), [clear])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
  }
}
