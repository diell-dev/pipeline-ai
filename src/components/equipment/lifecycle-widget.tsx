'use client'

/**
 * Equipment Lifecycle Widget
 *
 * Dashboard tile (owner/manager). Pulls /api/dashboard/equipment-lifecycle
 * and surfaces overdue, due-soon, and past-lifespan equipment with the
 * estimated replacement cost — plus a tiny bar chart of cost by category.
 */
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, Clock, Layers, Wrench, Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LifecycleResponse {
  dueSoon: number
  dueSoonCost: number
  overdue: number
  overdueCost?: number
  pastLifespan?: number
  pastLifespanCost?: number
  byCategory?: Array<{ category_name: string; cost: number; count: number }>
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export function EquipmentLifecycleWidget() {
  const [data, setData] = useState<LifecycleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/dashboard/equipment-lifecycle', { cache: 'no-store' })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = (await res.json()) as LifecycleResponse
        if (!cancelled) setData(json)
      } catch (err) {
        console.error('Lifecycle widget fetch failed', err)
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const topCategories = (data?.byCategory ?? []).slice(0, 5)
  const maxCost = topCategories.reduce((m, c) => Math.max(m, c.cost), 0) || 1

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Equipment Lifecycle
        </h2>
        <p className="text-sm text-muted-foreground">
          Replacement and service obligations across your installed base.
        </p>
      </div>

      {/* UX-SWEEP-#15: collapse the 3 zero cards into a single success line
          when there's nothing to flag — otherwise the widget feels empty. */}
      {!loading && (data?.overdue ?? 0) === 0 && (data?.dueSoon ?? 0) === 0 && (data?.pastLifespan ?? 0) === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          All equipment current — no overdue or upcoming service items.
        </div>
      ) : (
        // Phase D: combined card with a tiny inline bar chart so the three
        // categories can be compared at a glance instead of jumping eyes
        // between three large stat cards.
        <Card>
          <CardContent className="p-4 sm:p-5">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <LifecycleBarChart
                segments={[
                  {
                    key: 'overdue',
                    label: 'Overdue',
                    icon: AlertTriangle,
                    count: data?.overdue ?? 0,
                    cost: data?.overdueCost ?? 0,
                    tone: 'danger',
                  },
                  {
                    key: 'dueSoon',
                    label: 'Due in 90 days',
                    icon: Clock,
                    count: data?.dueSoon ?? 0,
                    cost: data?.dueSoonCost ?? 0,
                    tone: 'warning',
                  },
                  {
                    key: 'pastLifespan',
                    label: 'Past lifespan',
                    icon: Layers,
                    count: data?.pastLifespan ?? 0,
                    cost: data?.pastLifespanCost ?? 0,
                    tone: 'neutral',
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Cost by category. UX-SWEEP-#16: hide entirely when there's nothing
          meaningful to compare (single category or all-zero costs). */}
      {!loading && topCategories.length > 1 && topCategories.some((c) => c.cost > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Replacement cost by category (top 5)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {topCategories.map((c) => {
                const pct = Math.max(2, Math.round((c.cost / maxCost) * 100))
                return (
                  <li key={c.category_name} className="text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{c.category_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.count} units · {formatCurrency(c.cost)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className="h-full bg-zinc-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {error && !loading && (
        <p className="text-xs text-muted-foreground">
          Lifecycle data unavailable right now.
        </p>
      )}
    </div>
  )
}

export default EquipmentLifecycleWidget

// ────────────────────────────────────────────────────────────────────────
// LifecycleBarChart — Phase D
// Tiny inline bar chart that compares overdue / due-soon / past-lifespan
// counts at a glance. Each row: label · count · horizontal bar · est. cost.
// Bars use the maximum count across the three segments as the denominator,
// not an arbitrary fixed scale, so even small absolute counts read clearly.
// ────────────────────────────────────────────────────────────────────────

type SegmentTone = 'danger' | 'warning' | 'neutral'

interface BarSegment {
  key: string
  label: string
  icon: LucideIcon
  count: number
  cost: number
  tone: SegmentTone
}

const SEGMENT_BAR_CLASSES: Record<SegmentTone, string> = {
  danger: 'bg-red-500 dark:bg-red-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  neutral: 'bg-zinc-500 dark:bg-zinc-400',
}

const SEGMENT_LABEL_CLASSES: Record<SegmentTone, string> = {
  danger: 'text-red-700 dark:text-red-300',
  warning: 'text-amber-800 dark:text-amber-300',
  neutral: 'text-zinc-700 dark:text-zinc-300',
}

function LifecycleBarChart({ segments }: { segments: BarSegment[] }) {
  // Use the max count as the 100% mark so even small numbers render at a
  // useful width (a 3-unit bar isn't visible if the scale is fixed at 100).
  const maxCount = segments.reduce((m, s) => Math.max(m, s.count), 0) || 1
  const totalCost = segments.reduce((sum, s) => sum + s.cost, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Service obligations
        </h3>
        {totalCost > 0 && (
          <span className="text-xs text-muted-foreground">
            Est. {formatCurrency(totalCost)} total
          </span>
        )}
      </div>

      <ul className="space-y-2.5" aria-label="Equipment service obligations">
        {segments.map((seg) => {
          const Icon = seg.icon
          const widthPct =
            seg.count === 0 ? 0 : Math.max(4, Math.round((seg.count / maxCount) * 100))
          return (
            <li key={seg.key} className="flex items-center gap-3">
              <div className="flex w-32 min-w-0 items-center gap-1.5 shrink-0 sm:w-40">
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    SEGMENT_LABEL_CLASSES[seg.tone]
                  )}
                  aria-hidden
                />
                <span className="truncate text-xs font-medium text-foreground">
                  {seg.label}
                </span>
              </div>

              <div className="flex flex-1 items-center gap-2 min-w-0">
                <div
                  className="h-2 flex-1 rounded-full bg-muted overflow-hidden"
                  role="img"
                  aria-label={`${seg.count} ${seg.label.toLowerCase()}`}
                >
                  {seg.count > 0 && (
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        SEGMENT_BAR_CLASSES[seg.tone]
                      )}
                      style={{ width: `${widthPct}%` }}
                    />
                  )}
                </div>
                <span
                  className={cn(
                    'tabular-nums text-sm font-semibold shrink-0 w-8 text-right',
                    seg.count === 0
                      ? 'text-muted-foreground'
                      : SEGMENT_LABEL_CLASSES[seg.tone]
                  )}
                >
                  {seg.count}
                </span>
              </div>

              <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0">
                {seg.cost > 0 ? formatCurrency(seg.cost) : '—'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
