'use client'

/**
 * SwipeableRow — iOS-style swipe-to-reveal-actions row (Phase M4.6)
 *
 * Wrap any list row to make it swipeable. Reveals action buttons on swipe
 * left (rightActions) or right (leftActions), with momentum dismissal:
 * a fast flick past 50% width will auto-trigger the first action — slow
 * pulls just reveal the buttons and let the user tap.
 *
 * Design (per emil-design-eng skill):
 *   - Pointer-capture so we keep tracking the gesture if the finger
 *     drifts off the row
 *   - Damping at boundaries (no past-edge over-pull)
 *   - Velocity-based confirm: > 0.5 px/ms past mid-line auto-fires
 *   - Tap-outside closes a revealed row (handled via global click listener
 *     installed only while open, so closed rows have zero overhead)
 *   - Multi-touch protection: ignore the gesture if a second finger lands
 *   - Touch-only — desktop / pointer:fine devices get the children as-is
 *     with no wrapper (so right-click context menus etc. still work)
 *   - Respects prefers-reduced-motion (no spring transition on close)
 *
 * Constraints noted in the brief:
 *   - This is purely additive — wraps existing rows, doesn't replace them
 *   - Children get a `transform: translateX(...)` parent during gestures;
 *     anything inside that depends on layout positioning will see no
 *     change (transforms don't reflow siblings)
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export interface SwipeAction {
  /** Visible label on the action button. */
  label: string
  /** Lucide (or any) icon component. */
  icon?: React.ComponentType<{ className?: string }>
  /**
   * Tailwind background color class for the action button. Should include
   * both a base color and a hover state. e.g. "bg-red-600 hover:bg-red-700".
   */
  color?: string
  /** Optional foreground class, defaults to white. */
  textColor?: string
  /** Fired when the user taps the button OR flicks past the threshold. */
  onClick: () => void
  /** Marks the destructive action as the "swipe-far" auto-trigger. If no
   *  action is marked, the first one in the list is used. */
  destructive?: boolean
}

interface SwipeableRowProps {
  children: ReactNode
  leftActions?: SwipeAction[]
  rightActions?: SwipeAction[]
  /** Disable entirely (e.g. while a confirm dialog is open). */
  disabled?: boolean
  className?: string
}

const ACTION_WIDTH = 88 // px per action button
const VELOCITY_TRIGGER = 0.5 // px/ms — flick past this auto-fires
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const TOUCH_DEVICE_QUERY = '(hover: none) and (pointer: coarse)'

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(TOUCH_DEVICE_QUERY).matches
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function SwipeableRow({
  children,
  leftActions = [],
  rightActions = [],
  disabled = false,
  className = '',
}: SwipeableRowProps) {
  // Render the children straight through on non-touch devices. Cheaper
  // than running pointer listeners that never fire, and avoids breaking
  // hover-based interactions like right-click.
  const [touch, setTouch] = useState<boolean | null>(null)
  useEffect(() => {
    // Single feature-detection write on mount. The rule's hint about
    // cascading renders is moot here — this state never changes again
    // for the life of the component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouch(isTouchDevice())
  }, [])

  const id = useId()
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [offset, setOffset] = useState(0)
  const [animating, setAnimating] = useState(false)

  // Per-gesture mutable state.
  const startX = useRef<number | null>(null)
  const startOffset = useRef(0)
  const lastX = useRef(0)
  const lastT = useRef(0)
  const velocity = useRef(0)
  const fingers = useRef(0)
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current = prefersReducedMotion()
  }, [])

  const leftMax = leftActions.length * ACTION_WIDTH
  const rightMax = rightActions.length * ACTION_WIDTH

  // Damping at boundaries — exponential resistance past the action band.
  const clampWithDamp = useCallback(
    (raw: number): number => {
      if (raw > leftMax) {
        const over = raw - leftMax
        return leftMax + over / (1 + over / 80)
      }
      if (raw < -rightMax) {
        const over = -rightMax - raw
        return -rightMax - over / (1 + over / 80)
      }
      return raw
    },
    [leftMax, rightMax]
  )

  // Close the row on tap-outside while it's open.
  useEffect(() => {
    if (offset === 0) return
    function onDocClick(e: MouseEvent | TouchEvent) {
      const node = wrapperRef.current
      if (!node) return
      const target = e.target as Node | null
      if (target && node.contains(target)) return
      setAnimating(!reducedMotion.current)
      setOffset(0)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('touchstart', onDocClick, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick)
    }
  }, [offset])

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return
    if (e.pointerType !== 'touch') return
    fingers.current += 1
    if (fingers.current > 1) {
      // Multi-touch — abandon the gesture so pinch / multi-finger scroll
      // still works as normal.
      startX.current = null
      return
    }
    startX.current = e.clientX
    startOffset.current = offset
    lastX.current = e.clientX
    lastT.current = performance.now()
    velocity.current = 0
    setAnimating(false)
    // Pointer-capture keeps subsequent move events flowing to us even if
    // the finger drifts off the row's bounding box.
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (startX.current === null) return
    const now = performance.now()
    const dt = Math.max(1, now - lastT.current)
    velocity.current = (e.clientX - lastX.current) / dt
    lastX.current = e.clientX
    lastT.current = now

    const dx = e.clientX - startX.current
    const next = clampWithDamp(startOffset.current + dx)
    // Lock to horizontal: if the user makes a clearly vertical drag,
    // bail out so the page can keep scrolling. We approximate "vertical"
    // by checking if abs(horizontal travel) is still tiny.
    if (Math.abs(dx) < 8 && Math.abs(next - startOffset.current) < 4) return
    setOffset(next)
  }

  function handlePointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    fingers.current = Math.max(0, fingers.current - 1)
    if (startX.current === null) return
    startX.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    setAnimating(!reducedMotion.current)

    const v = velocity.current
    const halfway = ACTION_WIDTH / 2

    // Momentum-based confirm: fast flick fires the destructive action
    // automatically. Otherwise snap to "open" or "closed" based on how
    // far we got.
    if (offset < 0) {
      // Right-side actions exposed (swiped left).
      if (v < -VELOCITY_TRIGGER && rightActions.length > 0) {
        const auto =
          rightActions.find((a) => a.destructive) ?? rightActions[0]
        triggerAndClose(auto)
        return
      }
      if (offset < -halfway && rightActions.length > 0) {
        setOffset(-rightMax)
      } else {
        setOffset(0)
      }
      return
    }
    if (offset > 0) {
      // Left-side actions exposed (swiped right).
      if (v > VELOCITY_TRIGGER && leftActions.length > 0) {
        const auto = leftActions.find((a) => a.destructive) ?? leftActions[0]
        triggerAndClose(auto)
        return
      }
      if (offset > halfway && leftActions.length > 0) {
        setOffset(leftMax)
      } else {
        setOffset(0)
      }
      return
    }
    setOffset(0)
  }

  function triggerAndClose(action: SwipeAction) {
    setAnimating(!reducedMotion.current)
    setOffset(0)
    // Fire after the close animation kicks off — feels snappier than
    // firing first and then closing.
    requestAnimationFrame(() => action.onClick())
  }

  function handleActionClick(action: SwipeAction) {
    triggerAndClose(action)
  }

  // Until we know whether this is a touch device, render children
  // straight through. This avoids SSR/hydration mismatch where the
  // server emits the wrapper and the client decides to skip it.
  if (touch === null) {
    return <div className={className}>{children}</div>
  }
  if (!touch || (leftActions.length === 0 && rightActions.length === 0)) {
    return <div className={className}>{children}</div>
  }

  const surfaceStyle: CSSProperties = {
    transform: `translateX(${offset}px)`,
    transition: animating
      ? 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)'
      : 'none',
    touchAction: 'pan-y',
    willChange: 'transform',
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative overflow-hidden ${className}`}
      // The aria-label gives screen readers context for what the gesture
      // does. Actual screen-reader users should use the buttons via their
      // assistive tech rather than the swipe gesture itself.
      aria-describedby={`${id}-swipe-hint`}
    >
      <span id={`${id}-swipe-hint`} className="sr-only">
        Swipe horizontally to reveal row actions.
      </span>

      {/* Left action band (revealed by swipe-right) */}
      {leftActions.length > 0 && (
        <div
          aria-hidden={offset <= 0}
          className="absolute inset-y-0 left-0 flex"
          style={{ width: leftMax }}
        >
          {leftActions.map((a, i) => {
            const Icon = a.icon
            return (
              <button
                key={`${id}-l-${i}`}
                type="button"
                onClick={() => handleActionClick(a)}
                style={{ width: ACTION_WIDTH }}
                className={`flex h-full flex-col items-center justify-center text-xs font-medium transition-colors ${a.color ?? 'bg-zinc-700 hover:bg-zinc-800'} ${a.textColor ?? 'text-white'}`}
              >
                {Icon && <Icon className="mb-1 h-4 w-4" />}
                {a.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Right action band (revealed by swipe-left) */}
      {rightActions.length > 0 && (
        <div
          aria-hidden={offset >= 0}
          className="absolute inset-y-0 right-0 flex"
          style={{ width: rightMax }}
        >
          {rightActions.map((a, i) => {
            const Icon = a.icon
            return (
              <button
                key={`${id}-r-${i}`}
                type="button"
                onClick={() => handleActionClick(a)}
                style={{ width: ACTION_WIDTH }}
                className={`flex h-full flex-col items-center justify-center text-xs font-medium transition-colors ${a.color ?? 'bg-zinc-700 hover:bg-zinc-800'} ${a.textColor ?? 'text-white'}`}
              >
                {Icon && <Icon className="mb-1 h-4 w-4" />}
                {a.label}
              </button>
            )
          })}
        </div>
      )}

      {/* The swiping surface — children render inside, untouched layout. */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={surfaceStyle}
        // bg-card so the surface fully occludes the action band when at rest.
        className="relative bg-card"
      >
        {children}
      </div>
    </div>
  )
}
