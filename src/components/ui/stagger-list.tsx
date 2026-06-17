'use client'

/**
 * StaggerList — Emil Kowalski list-entrance primitive (M3).
 *
 * Drops a polished "first mount only" stagger onto any rendered list so
 * the page doesn't slam every row in at once. Designed to be a low-risk
 * swap-in: callers pass `items` + a `renderItem` function and the
 * component handles `motion.li` wrapping, reduced-motion fallback, and
 * the visible-on-scroll trigger.
 *
 *   <StaggerList
 *     items={jobs}
 *     renderItem={(job) => <JobRow job={job} />}
 *     getKey={(job) => job.id}
 *   />
 *
 * Defaults follow Emil's rules:
 *   - 40ms per-item stagger (range: 30-80ms feels right).
 *   - Capped at the first 8 items so a 200-row list doesn't lag.
 *   - `viewport={{ once: true }}` — never re-stagger on re-render.
 *   - 8px translateY entrance — never start from scale(0); never animate
 *     layout-affecting properties (height/width/margin).
 *   - `useReducedMotion()` opt-out: `prefers-reduced-motion: reduce`
 *     users get the final state immediately, no entry animation.
 *
 * For non-array contexts, see `<StaggerItem />` below — wrap individual
 * children manually with an `index` prop.
 */
import * as React from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

interface StaggerListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  /** Stable key per item. Defaults to array index — pass for stable lists. */
  getKey?: (item: T, index: number) => React.Key
  /** Delay between items, in ms. Default 40 (Emil sweet spot: 30-80). */
  staggerMs?: number
  /** After this many items the delay caps — long lists never lag. Default 8. */
  maxItems?: number
  /** Tag for the wrapping list element. Default `'ul'`. */
  as?: 'ul' | 'ol' | 'div'
  /** Tag for each item element. Default `'li'` when `as` is ul/ol, else `'div'`. */
  itemAs?: 'li' | 'div'
  className?: string
  itemClassName?: string
}

export function StaggerList<T>({
  items,
  renderItem,
  getKey,
  staggerMs = 40,
  maxItems = 8,
  as = 'ul',
  itemAs,
  className,
  itemClassName,
}: StaggerListProps<T>) {
  const reduce = useReducedMotion()
  const ListTag = as
  const ItemTag = itemAs ?? (as === 'div' ? 'div' : 'li')
  // motion.* respects the dynamic element tag at runtime, but TypeScript
  // needs a concrete component reference — pick at render time.
  const MotionItem =
    ItemTag === 'li' ? motion.li : motion.div

  return (
    <ListTag className={className}>
      {items.map((item, i) => {
        const key = getKey ? getKey(item, i) : i
        const delay = Math.min(i, maxItems) * (staggerMs / 1000)
        return (
          <MotionItem
            key={key}
            className={cn(itemClassName)}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{
              duration: 0.3,
              delay,
              // Emil-flavored ease-out — matches --ease-out-strong from
              // design-tokens.css so JS-driven motion and CSS keyframes
              // share the same curve family.
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {renderItem(item, i)}
          </MotionItem>
        )
      })}
    </ListTag>
  )
}

/**
 * StaggerItem — single-item version for when the caller can't pass an
 * `items` array (e.g. heterogeneous children, JSX-shaped trees).
 * Pass `index` explicitly so the delay schedule lines up.
 */
interface StaggerItemProps extends React.HTMLAttributes<HTMLDivElement> {
  index: number
  staggerMs?: number
  maxItems?: number
}

export function StaggerItem({
  index,
  staggerMs = 40,
  maxItems = 8,
  className,
  children,
  ...rest
}: StaggerItemProps) {
  const reduce = useReducedMotion()
  const delay = Math.min(index, maxItems) * (staggerMs / 1000)
  return (
    <motion.div
      className={cn(className)}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.3, delay, ease: [0.16, 1, 0.3, 1] }}
      {...(rest as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  )
}
