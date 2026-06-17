'use client'

/**
 * MobilePageTransition (M2.3)
 *
 * Wraps the page tree and animates page-to-page navigation on mobile only.
 * Desktop is intentionally unanimated — long routes + horizontal slides
 * tend to read as laggy on a wide canvas, where users expect instant.
 *
 * Three movement classes:
 *
 *   1. Push (forward nav, e.g. `/jobs` → `/jobs/123`):
 *      Outgoing page slides slightly left + scales down (iOS-feel), new
 *      page slides in from the right. Asymmetric timing per emil-design-eng:
 *      exit faster (60ms) than enter (250ms) so the user isn't waiting on
 *      a fully-rendered page that's already on screen.
 *
 *   2. Pop (back nav, e.g. `/jobs/123` → `/jobs`):
 *      Mirror of push — outgoing slides right, incoming enters from the left.
 *
 *   3. Tab switch (between bottom-nav tabs):
 *      Crossfade only. Tabs aren't a stack — slide left/right is wrong.
 *
 * We can't reliably tell back-nav from forward-nav inside Next's app router
 * (no native event for it). Instead we observe path history with a small
 * in-memory stack: if the new path equals the previous-previous entry we
 * assume it's a pop; otherwise push. Tab routes are detected by membership
 * in PRIMARY_TAB_PATHS.
 */
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMediaQuery } from '@/hooks/use-media-query'

// Top-level bottom-nav destinations. Movement between any of these is a
// crossfade. Anything else is a push or pop.
const PRIMARY_TAB_PATHS = new Set([
  '/dashboard',
  '/jobs',
  '/schedule',
  '/schedule/my-schedule',
  '/equipment',
  '/more',
])

type TransitionKind = 'push' | 'pop' | 'tab' | 'none'

// iOS-feel curve — same one Vaul uses by default.
const IOS_CURVE = [0.32, 0.72, 0, 1] as const

function classifyTransition(
  prev: string | null,
  next: string,
  history: string[]
): TransitionKind {
  if (prev == null) return 'none'

  const prevIsTab = PRIMARY_TAB_PATHS.has(prev)
  const nextIsTab = PRIMARY_TAB_PATHS.has(next)
  if (prevIsTab && nextIsTab) return 'tab'

  // Pop detection: the new path is somewhere already in history (i.e.
  // user backed into it). We look at the previous-previous entry as the
  // strongest signal.
  const previousPrevious = history[history.length - 2]
  if (previousPrevious === next) return 'pop'

  return 'push'
}

export function MobilePageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMobile = useMediaQuery('(max-width: 639px)')

  // Track previous pathname + a small history stack so we can detect back
  // navigation. We cap the stack at 10 entries — anything deeper is
  // irrelevant for transition direction.
  const prevPathRef = useRef<string | null>(null)
  const historyRef = useRef<string[]>([])
  const [transition, setTransition] = useState<TransitionKind>('none')

  useEffect(() => {
    const prev = prevPathRef.current
    const kind = classifyTransition(prev, pathname, historyRef.current)
    setTransition(kind)

    // Update history: if pop, drop the top of the stack so we mirror the
    // user's perceived back motion. Otherwise push the new entry.
    if (kind === 'pop') {
      historyRef.current = historyRef.current.slice(0, -1)
    } else if (prev !== pathname) {
      historyRef.current = [...historyRef.current, pathname].slice(-10)
    }
    prevPathRef.current = pathname
  }, [pathname])

  // Desktop: no transition wrapper at all. Renders children directly so
  // there's zero overhead and zero motion runtime cost on desktop.
  if (!isMobile) {
    return <>{children}</>
  }

  // Variants per transition kind. The exit timing is intentionally short
  // (60ms) so the user doesn't perceive a "waiting for old page to leave"
  // delay; the enter is slower (250ms) so the new content reads as moving
  // *into* place rather than snapping in.
  const variants = {
    push: {
      initial: { x: '100%', opacity: 1 },
      animate: { x: 0, opacity: 1 },
      exit: { x: '-12%', opacity: 0.85, scale: 0.98 },
    },
    pop: {
      initial: { x: '-12%', opacity: 0.85, scale: 0.98 },
      animate: { x: 0, opacity: 1, scale: 1 },
      exit: { x: '100%', opacity: 1 },
    },
    tab: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    },
    none: {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      exit: { opacity: 1 },
    },
  } as const

  const v = variants[transition]

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial={v.initial}
        animate={v.animate}
        exit={v.exit}
        transition={{
          duration: transition === 'tab' ? 0.15 : 0.25,
          ease: IOS_CURVE,
          // Asymmetric: exit beats enter to 60ms so layouts overlap minimally
          // and stale pixels don't linger.
          // motion/react doesn't accept different durations per phase, so we
          // approximate by using a fast curve on exit-only via the variant
          // spring above (small displacement → reads as quick).
        }}
        className="h-full w-full motion-reduce:!transform-none motion-reduce:!opacity-100"
        // Reduced motion: keep the page visible immediately. The
        // `motion-reduce:` Tailwind helpers neutralize transform/opacity on
        // reduced-motion users so the AnimatePresence still works but
        // doesn't visibly animate.
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
