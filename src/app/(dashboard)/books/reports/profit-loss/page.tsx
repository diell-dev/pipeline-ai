'use client'

/**
 * Profit & Loss report page.
 *
 * Default range: start of current year → today. The user can pivot to
 * any window; the report recomputes on every change with a brief
 * skeleton while the query is in flight.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, DollarSign, MinusCircle, TrendingUp } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { KPICard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getProfitAndLoss,
  type AccountGroup,
  type ProfitAndLossReport,
} from '@/lib/books/reports'
import { centsToDollars, formatCurrency, formatPercent, startOfYearIso, todayIso } from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

export default function ProfitLossPage() {
  return (
    <ReportPageGuard>
      <ProfitLossInner />
    </ReportPageGuard>
  )
}

function ProfitLossInner() {
  const { organization } = useAuthStore()
  const [startDate, setStartDate] = useState<string>(startOfYearIso())
  const [endDate, setEndDate] = useState<string>(todayIso())
  const [report, setReport] = useState<ProfitAndLossReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getProfitAndLoss(supabase, organization.id, startDate, endDate)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profit & loss report.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [organization, startDate, endDate])

  useEffect(() => {
    load()
  }, [load])

  const csvRows = useMemo(() => {
    return () => {
      if (!report) return []
      const rows: (string | number)[][] = []
      rows.push(['Profit & Loss', '', ''])
      rows.push([`Period: ${report.startDate} to ${report.endDate}`, '', ''])
      rows.push([])
      rows.push(['Section', 'Account', 'Amount (USD)'])

      const pushGroup = (label: string, group: AccountGroup) => {
        for (const row of group.byAccount) {
          rows.push([
            label,
            `${row.account_code} ${row.account_name}`,
            centsToDollars(row.amount_cents),
          ])
        }
        rows.push([label, 'Total', centsToDollars(group.total_cents)])
        rows.push([])
      }

      pushGroup('Revenue', report.revenue)
      pushGroup('Cost of Goods Sold', report.cogs)
      rows.push(['Gross Profit', '', centsToDollars(report.grossProfit.amount_cents)])
      rows.push([])
      pushGroup('Operating Expenses', report.operatingExpenses)
      rows.push([
        'Operating Income',
        '',
        centsToDollars(report.operatingIncome.amount_cents),
      ])
      rows.push([])
      pushGroup('Other Income', report.otherIncome)
      pushGroup('Other Expenses', report.otherExpenses)
      rows.push(['Net Income', '', centsToDollars(report.netIncome.amount_cents)])
      return rows
    }
  }, [report])

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Reports', href: '/books/reports' },
          { label: 'Profit & Loss' },
        ]}
        title="Profit & Loss"
        subtitle="Revenue, cost of goods sold, expenses, and net income for the selected period."
      />

      <ReportToolbar
        mode="range"
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        loading={loading}
        getCsvRows={csvRows}
        csvFilename={`profit_loss_${startDate}_to_${endDate}`}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          icon={TrendingUp}
          label="Revenue"
          value={loading ? '—' : formatCurrency(report?.revenue.total_cents)}
          loading={loading}
        />
        <KPICard
          icon={MinusCircle}
          label="Total Expenses"
          value={
            loading
              ? '—'
              : formatCurrency(
                  (report?.cogs.total_cents ?? 0) +
                    (report?.operatingExpenses.total_cents ?? 0) +
                    (report?.otherExpenses.total_cents ?? 0)
                )
          }
          loading={loading}
        />
        <KPICard
          icon={DollarSign}
          label="Gross Profit"
          value={loading ? '—' : formatCurrency(report?.grossProfit.amount_cents)}
          helper={
            report && report.revenue.total_cents
              ? `${formatPercent(report.grossProfit.margin_pct)} margin`
              : undefined
          }
          loading={loading}
        />
        <KPICard
          icon={DollarSign}
          label="Net Income"
          value={
            loading ? (
              '—'
            ) : (
              <span
                className={
                  (report?.netIncome.amount_cents ?? 0) >= 0
                    ? 'text-emerald-600'
                    : 'text-red-600'
                }
              >
                {formatCurrency(report?.netIncome.amount_cents)}
              </span>
            )
          }
          loading={loading}
        />
      </div>

      {/* Body */}
      {error ? (
        <EmptyState icon={AlertTriangle} title="Could not load report" description={error} />
      ) : loading ? (
        <ReportTableSkeleton />
      ) : !report ||
        (report.revenue.byAccount.length === 0 &&
          report.cogs.byAccount.length === 0 &&
          report.operatingExpenses.byAccount.length === 0 &&
          report.otherIncome.byAccount.length === 0 &&
          report.otherExpenses.byAccount.length === 0) ? (
        <EmptyState
          icon={TrendingUp}
          title="No activity in this period"
          description="No posted journal entries fall inside the chosen window. Adjust the dates or post some invoices/bills to see numbers here."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Account
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <GroupRows label="Revenue" group={report.revenue} />
                  <GroupRows label="Cost of Goods Sold" group={report.cogs} />
                  <SubtotalRow
                    label="Gross Profit"
                    amount={report.grossProfit.amount_cents}
                    margin={report.grossProfit.margin_pct}
                  />
                  <GroupRows label="Operating Expenses" group={report.operatingExpenses} />
                  <SubtotalRow
                    label="Operating Income"
                    amount={report.operatingIncome.amount_cents}
                    margin={report.operatingIncome.margin_pct}
                  />
                  <GroupRows label="Other Income" group={report.otherIncome} />
                  <GroupRows label="Other Expenses" group={report.otherExpenses} />
                  <tr className="border-t-2 border-foreground/70 bg-muted/40">
                    <td className="px-4 py-3 font-heading text-base font-semibold">
                      Net Income
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-heading text-base font-semibold ${
                        report.netIncome.amount_cents >= 0
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                    >
                      {formatCurrency(report.netIncome.amount_cents)}
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

// ============================================================
// Row helpers
// ============================================================

function GroupRows({ label, group }: { label: string; group: AccountGroup }) {
  return (
    <>
      <tr className="bg-muted/30">
        <td className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" colSpan={2}>
          {label}
        </td>
      </tr>
      {group.byAccount.length === 0 ? (
        <tr>
          <td className="px-4 py-2 pl-8 text-sm text-muted-foreground" colSpan={2}>
            (none)
          </td>
        </tr>
      ) : (
        group.byAccount.map((row) => (
          <tr key={row.account_id} className="border-b last:border-b-0">
            <td className="px-4 py-2 pl-8 text-sm">
              <span className="text-muted-foreground">{row.account_code}</span>{' '}
              <span>{row.account_name}</span>
            </td>
            <td className="px-4 py-2 text-right text-sm tabular-nums">
              {formatCurrency(row.amount_cents)}
            </td>
          </tr>
        ))
      )}
      <tr className="border-b">
        <td className="px-4 py-2 pl-8 text-sm font-medium text-foreground">
          Total {label}
        </td>
        <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
          {formatCurrency(group.total_cents)}
        </td>
      </tr>
    </>
  )
}

function SubtotalRow({
  label,
  amount,
  margin,
}: {
  label: string
  amount: number
  margin: number | null
}) {
  return (
    <tr className="border-y bg-foreground/[0.02]">
      <td className="px-4 py-2.5 font-semibold text-foreground">
        {label}
        {margin != null && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ({formatPercent(margin)})
          </span>
        )}
      </td>
      <td
        className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
          amount >= 0 ? 'text-foreground' : 'text-red-600'
        }`}
      >
        {formatCurrency(amount)}
      </td>
    </tr>
  )
}

function ReportTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}
