'use client'

/**
 * Trial Balance report page.
 *
 * Lists every account that has any posted activity with its debit
 * total, credit total, and natural balance. A balanced ledger is the
 * pre-condition for every other report — so this is the smoke check.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, CheckCircle2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { KPICard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getTrialBalance, type TrialBalanceReport } from '@/lib/books/reports'
import { centsToDollars, formatCurrency, todayIso } from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

export default function TrialBalancePage() {
  return (
    <ReportPageGuard>
      <TrialBalanceInner />
    </ReportPageGuard>
  )
}

function TrialBalanceInner() {
  const { organization } = useAuthStore()
  const [asOfDate, setAsOfDate] = useState<string>(todayIso())
  const [report, setReport] = useState<TrialBalanceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getTrialBalance(supabase, organization.id, asOfDate)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trial balance.')
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
      rows.push(['Trial Balance', `As of ${report.asOfDate}`])
      rows.push([])
      rows.push(['Code', 'Account', 'Type', 'Debit (USD)', 'Credit (USD)'])
      for (const acc of report.accounts) {
        rows.push([
          acc.account_code,
          acc.account_name,
          acc.account_type,
          centsToDollars(acc.debit_total_cents),
          centsToDollars(acc.credit_total_cents),
        ])
      }
      rows.push([
        'Total',
        '',
        '',
        centsToDollars(report.totals.debits_cents),
        centsToDollars(report.totals.credits_cents),
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
          { label: 'Trial Balance' },
        ]}
        title="Trial Balance"
        subtitle="Every account with its debit and credit totals. Debits must equal credits."
      />

      <ReportToolbar
        mode="asOf"
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        loading={loading}
        getCsvRows={csvRows}
        csvFilename={`trial_balance_${asOfDate}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <KPICard
          icon={Calculator}
          label="Total Debits"
          value={loading ? '—' : formatCurrency(report?.totals.debits_cents)}
          loading={loading}
        />
        <KPICard
          label="Total Credits"
          value={loading ? '—' : formatCurrency(report?.totals.credits_cents)}
          loading={loading}
        />
        <KPICard
          icon={CheckCircle2}
          label="Balanced"
          value={
            loading ? (
              '—'
            ) : (
              <span
                className={
                  report?.totals.isBalanced ? 'text-emerald-600' : 'text-red-600'
                }
              >
                {report?.totals.isBalanced ? 'Yes' : 'No'}
              </span>
            )
          }
          helper={
            report && !report.totals.isBalanced
              ? `Off by ${formatCurrency(
                  Math.abs(report.totals.debits_cents - report.totals.credits_cents)
                )}`
              : 'Debits = Credits'
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
      ) : !report || report.accounts.length === 0 ? (
        <EmptyState
          icon={Calculator}
          title="No posted activity yet"
          description="Post some journal entries (e.g. invoices, bills) and this report will fill in."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Code
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Account
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Type
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Debit
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Credit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.accounts.map((acc) => (
                    <tr key={acc.account_id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-4 py-2 text-sm font-mono text-xs text-muted-foreground">
                        {acc.account_code}
                      </td>
                      <td className="px-4 py-2 text-sm">{acc.account_name}</td>
                      <td className="px-4 py-2 text-sm capitalize text-muted-foreground">
                        {acc.account_type}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(acc.debit_total_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(acc.credit_total_cents, { showZeroAsDash: true })}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground/70 bg-muted/40 font-semibold">
                    <td className="px-4 py-2.5" colSpan={3}>
                      Total
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.debits_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.credits_cents)}
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
