'use client'

/**
 * Sales Tax Summary report page.
 *
 * Per-rate breakdown of tax collected on invoices vs paid (recoverable)
 * on bills. The net owed column is what the user remits at filing time.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Landmark } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { KPICard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getSalesTaxSummary,
  type SalesTaxSummaryReport,
} from '@/lib/books/reports'
import {
  centsToDollars,
  formatCurrency,
  formatPercent,
  startOfYearIso,
  todayIso,
} from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

export default function SalesTaxPage() {
  return (
    <ReportPageGuard>
      <SalesTaxInner />
    </ReportPageGuard>
  )
}

function SalesTaxInner() {
  const { organization } = useAuthStore()
  const [startDate, setStartDate] = useState<string>(startOfYearIso())
  const [endDate, setEndDate] = useState<string>(todayIso())
  const [report, setReport] = useState<SalesTaxSummaryReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getSalesTaxSummary(supabase, organization.id, startDate, endDate)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sales tax summary.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [organization, startDate, endDate])

  useEffect(() => {
    load()
  }, [load])

  const csvRows = useMemo(
    () => () => {
      if (!report) return []
      const rows: (string | number)[][] = []
      rows.push(['Sales Tax Summary', `${report.startDate} to ${report.endDate}`])
      rows.push([])
      rows.push([
        'Tax Rate',
        'Rate %',
        'Taxable Sales',
        'Tax Collected',
        'Tax Paid (Recoverable)',
        'Net Owed',
      ])
      for (const r of report.rows) {
        rows.push([
          r.tax_rate_name,
          r.rate_pct,
          centsToDollars(r.taxable_subtotal_cents),
          centsToDollars(r.tax_collected_cents),
          centsToDollars(r.tax_paid_cents),
          centsToDollars(r.net_tax_owed_cents),
        ])
      }
      rows.push([
        'Total',
        '',
        centsToDollars(report.totals.taxable_subtotal_cents),
        centsToDollars(report.totals.tax_collected_cents),
        centsToDollars(report.totals.tax_paid_cents),
        centsToDollars(report.totals.net_tax_owed_cents),
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
          { label: 'Sales Tax' },
        ]}
        title="Sales Tax Summary"
        subtitle="Per-rate breakdown of tax collected vs paid. The Net Owed column is what you remit."
      />

      <ReportToolbar
        mode="range"
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        loading={loading}
        getCsvRows={csvRows}
        csvFilename={`sales_tax_${startDate}_to_${endDate}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          icon={Landmark}
          label="Taxable Sales"
          value={loading ? '—' : formatCurrency(report?.totals.taxable_subtotal_cents)}
          loading={loading}
        />
        <KPICard
          label="Tax Collected"
          value={loading ? '—' : formatCurrency(report?.totals.tax_collected_cents)}
          loading={loading}
        />
        <KPICard
          label="Tax Paid (Recoverable)"
          value={loading ? '—' : formatCurrency(report?.totals.tax_paid_cents)}
          loading={loading}
        />
        <KPICard
          label="Net Owed"
          value={
            loading ? (
              '—'
            ) : (
              <span
                className={
                  (report?.totals.net_tax_owed_cents ?? 0) > 0
                    ? 'text-amber-600'
                    : 'text-emerald-600'
                }
              >
                {formatCurrency(report?.totals.net_tax_owed_cents)}
              </span>
            )
          }
          loading={loading}
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
          icon={Landmark}
          title="No tax activity in this period"
          description="No invoices or bills with tax fall inside the chosen window."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Tax Rate
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Rate
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Taxable Sales
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Collected
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Paid (Recoverable)
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Net Owed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r, i) => (
                    <tr
                      key={r.tax_rate_id ?? `unspecified-${i}`}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2 text-sm">{r.tax_rate_name}</td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums text-muted-foreground">
                        {r.rate_pct ? formatPercent(r.rate_pct, { digits: 3 }) : '—'}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(r.taxable_subtotal_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(r.tax_collected_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(r.tax_paid_cents, { showZeroAsDash: true })}
                      </td>
                      <td
                        className={`px-4 py-2 text-right text-sm font-medium tabular-nums ${
                          r.net_tax_owed_cents > 0
                            ? 'text-amber-600'
                            : r.net_tax_owed_cents < 0
                              ? 'text-emerald-600'
                              : ''
                        }`}
                      >
                        {formatCurrency(r.net_tax_owed_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground/70 bg-muted/40 font-semibold">
                    <td className="px-4 py-2.5" colSpan={2}>
                      Total
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.taxable_subtotal_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.tax_collected_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.tax_paid_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.net_tax_owed_cents)}
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
