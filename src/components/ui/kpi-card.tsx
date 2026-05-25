'use client'

/**
 * KPICard — Phase C shared component
 *
 * Standardized stat card used by the dashboard + finances KPI strips.
 * Replaces the hand-rolled `<Card><CardHeader><CardTitle>` pattern that
 * was duplicated 8+ times on the dashboard alone.
 *
 * Features:
 *  - icon + label row
 *  - large value
 *  - optional helper text underneath
 *  - optional trend chip (up/down/flat with delta)
 *  - optional sparkline (tiny SVG line chart, no chart lib)
 *  - optional onClick → makes the card behave as a button (hover lift)
 *  - loading state → renders a skeleton in the value slot
 *
 * Uses design tokens; no hardcoded colors apart from the semantic
 * trend palette (green up / red down / muted flat).
 */
import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type TrendDirection = 'up' | 'down' | 'flat'

export interface KPITrend {
  /** Sign-less display string, e.g. "12%" or "$1.2k". */
  value: string
  direction: TrendDirection
  /** When set, overrides the auto good/bad coloring. Useful when
   *  "down" is actually a good thing (e.g. avg cycle time). */
  invertColor?: boolean
}

interface KPICardProps {
  label: React.ReactNode
  value: React.ReactNode
  icon?: LucideIcon
  helper?: React.ReactNode
  trend?: KPITrend
  /** Series of numbers, ~6–24 points, used for the sparkline. */
  sparkline?: number[]
  /** When provided, the card becomes interactive and routes on click. */
  onClick?: () => void
  loading?: boolean
  className?: string
}

function trendColor(direction: TrendDirection, invert?: boolean): string {
  if (direction === 'flat') return 'text-muted-foreground bg-muted'
  const isGood = invert ? direction === 'down' : direction === 'up'
  return isGood
    ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-500/10'
    : 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-500/10'
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (!data || data.length < 2) return null
  const width = 80
  const height = 28
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const step = width / (data.length - 1)
  const points = data
    .map((d, i) => {
      const x = i * step
      const y = height - ((d - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // Direction-aware color: trending up = brand, trending down = muted red
  const last = data[data.length - 1]
  const first = data[0]
  const trendingUp = last >= first
  const stroke = trendingUp ? 'stroke-brand-primary' : 'stroke-red-500'

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(stroke, 'opacity-80')}
      />
    </svg>
  )
}

export function KPICard({
  label,
  value,
  icon: Icon,
  helper,
  trend,
  sparkline,
  onClick,
  loading,
  className,
}: KPICardProps) {
  const interactive = typeof onClick === 'function'

  const cardClass = cn(
    'transition-shadow',
    interactive &&
      'cursor-pointer hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring outline-none',
    className
  )

  const TrendIcon =
    trend?.direction === 'up'
      ? ArrowUpRight
      : trend?.direction === 'down'
        ? ArrowDownRight
        : Minus

  const content = (
    <>
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
          <span className="truncate">{label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-none">
                {value}
              </div>
            )}
            {helper && !loading && (
              <p className="mt-1.5 text-xs text-muted-foreground leading-snug">
                {helper}
              </p>
            )}
          </div>
          {sparkline && sparkline.length > 1 && !loading && (
            <Sparkline data={sparkline} className="shrink-0" />
          )}
        </div>
        {trend && !loading && (
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                trendColor(trend.direction, trend.invertColor)
              )}
            >
              <TrendIcon className="h-3 w-3" aria-hidden="true" />
              {trend.value}
            </span>
          </div>
        )}
      </CardContent>
    </>
  )

  if (interactive) {
    return (
      <Card
        className={cardClass}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick?.()
          }
        }}
      >
        {content}
      </Card>
    )
  }

  return <Card className={cardClass}>{content}</Card>
}
