'use client'

/**
 * AR Aging report page.
 *
 * Shows open customer invoices bucketed by overdue age. Useful for the
 * collections call list — pay attention to anything in 60+ buckets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Receipt } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { KPICard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getARAging, type AgingReport } from '@/lib/books/reports'
import { centsToDollars, formatCurrency, todayIso } from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

export default function ArAgingPage() {
  return (
    <ReportPageGuard>
      <ArAgingInner />
    </ReportPageGuard>
  )
}

function ArAgingInner() {
  const { organization } = useAuthStore()
  const [asOfDate, setAsOfDate] = useState<string>(todayIso())
  const [report, setReport] = useState<AgingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getARAging(supabase, organization.id, asOfDate)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AR aging.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [organization, asOfDate])

  useEffect(() => {
    load()
  }, [load])

  const csvRows = useMemo(
    () => () => {
      if (!report) return []
      const rows: (string | number)[][] = []
      rows.push(['Accounts Receivable Aging', `As of ${report.asOfDate}`])
      rows.push([])
      rows.push(['Customer', 'Current', '1-30 days', '31-60 days', '61-90 days', '90+ days', 'Total'])
      for (const r of report.rows) {
        rows.push([
          r.party_name,
          centsToDollars(r.current_cents),
          centsToDollars(r.days_1_30_cents),
          centsToDollars(r.days_31_60_cents),
          centsToDollars(r.days_61_90_cents),
          centsToDollars(r.days_90_plus_cents),
          centsToDollars(r.total_cents),
        ])
      }
      rows.push([
        'Total',
        centsToDollars(report.totals.current_cents),
        centsToDollars(report.totals.days_1_30_cents),
        centsToDollars(report.totals.days_31_60_cents),
        centsToDollars(report.totals.days_61_90_cents),
        centsToDollars(report.totals.days_90_plus_cents),
        centsToDollars(report.totals.total_cents),
      ])
      return rows
    },
    [report]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Reports', href: '/books/reports' },
          { label: 'AR Aging' },
        ]}
        title="AR Aging"
        subtitle="Outstanding customer invoices bucketed by how overdue they are."
      />

      <ReportToolbar
        mode="asOf"
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        loading={loading}
        getCsvRows={csvRows}
        csvFilename={`ar_aging_${asOfDate}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          icon={Receipt}
          label="Total Outstanding"
          value={loading ? '—' : formatCurrency(report?.totals.total_cents)}
          loading={loading}
        />
        <KPICard
          label="Current"
          value={loading ? '—' : formatCurrency(report?.totals.current_cents)}
          loading={loading}
        />
        <KPICard
          label="31-90 days"
          value={
            loading
              ? '—'
              : formatCurrency(
                  (report?.totals.days_31_60_cents ?? 0) +
                    (report?.totals.days_61_90_cents ?? 0)
                )
          }
          loading={loading}
        />
        <KPICard
          label="90+ days"
          value={
            loading ? (
              '—'
            ) : (
              <span
                className={
                  (report?.totals.days_90_plus_cents ?? 0) > 0 ? 'text-red-600' : ''
                }
              >
                {formatCurrency(report?.totals.days_90_plus_cents)}
              </span>
            )
          }
          loading={loading}
          className={
            (report?.totals.days_90_plus_cents ?? 0) > 0 ? 'ring-red-200' : undefined
          }
        />
      </div>

      {error ? (
        <EmptyState icon={AlertTriangle} title="Could not load report" description={error} />
      ) : loading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : !report || report.rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No outstanding invoices"
          description="Every invoice on the books is paid in full as of this date. Nicely done."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Customer
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Current
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      1-30
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      31-60
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      61-90
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      90+
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr
                      key={row.party_id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2 text-sm">{row.party_name}</td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(row.current_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(row.days_1_30_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(row.days_31_60_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(row.days_61_90_cents, { showZeroAsDash: true })}
                      </td>
                      <td
                        className={`px-4 py-2 text-right text-sm tabular-nums ${
                          row.days_90_plus_cents > 0 ? 'text-red-600 font-medium' : ''
                        }`}
                      >
                        {formatCurrency(row.days_90_plus_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                        {formatCurrency(row.total_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground/70 bg-muted/40 font-semibold">
                    <td className="px-4 py-2.5 text-sm">Total</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                      {formatCurrency(report.totals.current_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                      {formatCurrency(report.totals.days_1_30_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                      {formatCurrency(report.totals.days_31_60_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                      {formatCurrency(report.totals.days_61_90_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                      {formatCurrency(report.totals.days_90_plus_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums">
                      {formatCurrency(report.totals.total_cents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
