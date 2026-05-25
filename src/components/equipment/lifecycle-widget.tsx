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
import { AlertTriangle, Clock, Layers, Wrench, Check } from 'lucide-react'

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
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          All equipment current — no overdue or upcoming service items.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-red-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Equipment Overdue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <div className="text-3xl font-bold text-red-700">
                  {data?.overdue ?? 0}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Est. cost {loading ? '—' : formatCurrency(data?.overdueCost ?? 0)}
              </p>
            </CardContent>
          </Card>

          <Card className="border-amber-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Due in 90 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <div className="text-3xl font-bold text-amber-800">{data?.dueSoon ?? 0}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Est. cost {loading ? '—' : formatCurrency(data?.dueSoonCost ?? 0)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Past Lifespan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <div className="text-3xl font-bold text-zinc-700">{data?.pastLifespan ?? 0}</div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Est. cost {loading ? '—' : formatCurrency(data?.pastLifespanCost ?? 0)}
              </p>
            </CardContent>
          </Card>
        </div>
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
