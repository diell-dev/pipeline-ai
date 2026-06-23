'use client'

/**
 * Cash Flow report page (indirect method).
 *
 * v1 surfaces the operating section in full; investing & financing
 * sections render as placeholders with "coming soon" copy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Wallet } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { KPICard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getCashFlow, type CashFlowReport } from '@/lib/books/reports'
import { centsToDollars, formatCurrency, startOfYearIso, todayIso } from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

export default function CashFlowPage() {
  return (
    <ReportPageGuard>
      <CashFlowInner />
    </ReportPageGuard>
  )
}

function CashFlowInner() {
  const { organization } = useAuthStore()
  const [startDate, setStartDate] = useState<string>(startOfYearIso())
  const [endDate, setEndDate] = useState<string>(todayIso())
  const [report, setReport] = useState<CashFlowReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getCashFlow(supabase, organization.id, startDate, endDate)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cash flow.')
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
      rows.push(['Cash Flow Statement', `${report.startDate} to ${report.endDate}`])
      rows.push([])
      rows.push(['Operating Activities', '', ''])
      rows.push(['Net Income', '', centsToDollars(report.operating.netIncome_cents)])
      for (const a of report.operating.adjustments) {
        rows.push([a.label, '', centsToDollars(a.amount_cents)])
      }
      rows.push([
        'Total Adjustments',
        '',
        centsToDollars(report.operating.totalAdjustments_cents),
      ])
      rows.push([
        'Cash from Operations',
        '',
        centsToDollars(report.operating.operatingCashFlow_cents),
      ])
      rows.push([])
      rows.push(['Investing Activities', '', centsToDollars(report.investing.total_cents)])
      rows.push(['Financing Activities', '', centsToDollars(report.financing.total_cents)])
      rows.push([
        'Net Change in Cash',
        '',
        centsToDollars(report.netChangeInCash_cents),
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
          { label: 'Cash Flow' },
        ]}
        title="Cash Flow"
        subtitle="Indirect method — starting from net income, adjusted for non-cash items and working capital."
      />

      <ReportToolbar
        mode="range"
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        loading={loading}
        getCsvRows={csvRows}
        csvFilename={`cash_flow_${startDate}_to_${endDate}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          icon={Wallet}
          label="Net Income"
          value={loading ? '—' : formatCurrency(report?.operating.netIncome_cents)}
          loading={loading}
        />
        <KPICard
          icon={ArrowUpCircle}
          label="Cash from Operations"
          value={
            loading
              ? '—'
              : formatCurrency(report?.operating.operatingCashFlow_cents)
          }
          loading={loading}
        />
        <KPICard
          icon={ArrowDownCircle}
          label="Total Adjustments"
          value={loading ? '—' : formatCurrency(report?.operating.totalAdjustments_cents)}
          loading={loading}
        />
        <KPICard
          icon={Wallet}
          label="Net Change in Cash"
          value={
            loading ? (
              '—'
            ) : (
              <span
                className={
                  (report?.netChangeInCash_cents ?? 0) >= 0
                    ? 'text-emerald-600'
                    : 'text-red-600'
                }
              >
                {formatCurrency(report?.netChangeInCash_cents)}
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
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : report ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Line
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-muted/30">
                    <td
                      className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      colSpan={2}
                    >
                      Operating Activities
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-4 py-2 pl-8 text-sm">Net Income</td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {formatCurrency(report.operating.netIncome_cents)}
                    </td>
                  </tr>
                  {report.operating.adjustments.map((adj, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-4 py-2 pl-8 text-sm">{adj.label}</td>
                      <td
                        className={`px-4 py-2 text-right text-sm tabular-nums ${
                          adj.amount_cents < 0 ? 'text-red-600' : ''
                        }`}
                      >
                        {formatCurrency(adj.amount_cents)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-y bg-foreground/[0.02]">
                    <td className="px-4 py-2.5 font-semibold">
                      Cash from Operating Activities
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatCurrency(report.operating.operatingCashFlow_cents)}
                    </td>
                  </tr>

                  <tr className="bg-muted/30">
                    <td
                      className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      colSpan={2}
                    >
                      Investing Activities
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-4 py-2 pl-8 text-sm text-muted-foreground italic">
                      Coming soon — derive from fixed-asset accounts.
                    </td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {formatCurrency(0)}
                    </td>
                  </tr>

                  <tr className="bg-muted/30">
                    <td
                      className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      colSpan={2}
                    >
                      Financing Activities
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-4 py-2 pl-8 text-sm text-muted-foreground italic">
                      Coming soon — derive from notes-payable and equity contributions.
                    </td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {formatCurrency(0)}
                    </td>
                  </tr>

                  <tr className="border-t-2 border-foreground/70 bg-muted/40">
                    <td className="px-4 py-3 font-heading text-base font-semibold">
                      Net Change in Cash
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-heading text-base font-semibold tabular-nums ${
                        report.netChangeInCash_cents >= 0
                          ? 'text-foreground'
                          : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(report.netChangeInCash_cents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
