'use client'

/**
 * Balance Sheet report page.
 *
 * Default as-of: today. Surfaces a top-line "balanced" indicator and an
 * EmptyState fallback when the GL has no posted activity yet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { KPICard } from '@/components/ui/kpi-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getBalanceSheet,
  type BalanceSheetLine,
  type BalanceSheetReport,
} from '@/lib/books/reports'
import { centsToDollars, formatCurrency, todayIso } from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

export default function BalanceSheetPage() {
  return (
    <ReportPageGuard>
      <BalanceSheetInner />
    </ReportPageGuard>
  )
}

function BalanceSheetInner() {
  const { organization } = useAuthStore()
  const [asOfDate, setAsOfDate] = useState<string>(todayIso())
  const [report, setReport] = useState<BalanceSheetReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getBalanceSheet(supabase, organization.id, asOfDate)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load balance sheet.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [organization, asOfDate])

  useEffect(() => {
    load()
  }, [load])

  const csvRows = useMemo(() => {
    return () => {
      if (!report) return []
      const rows: (string | number)[][] = []
      rows.push(['Balance Sheet', `As of ${report.asOfDate}`])
      rows.push([])
      rows.push(['Section', 'Account', 'Amount (USD)'])

      const pushLines = (section: string, lines: BalanceSheetLine[]) => {
        for (const l of lines) {
          rows.push([section, `${l.account_code} ${l.account_name}`, centsToDollars(l.amount_cents)])
        }
      }

      pushLines('Assets — Current', report.assets.current)
      pushLines('Assets — Non-current', report.assets.nonCurrent)
      rows.push(['Total Assets', '', centsToDollars(report.assets.total_cents)])
      rows.push([])
      pushLines('Liabilities — Current', report.liabilities.current)
      pushLines('Liabilities — Long-term', report.liabilities.longTerm)
      rows.push(['Total Liabilities', '', centsToDollars(report.liabilities.total_cents)])
      rows.push([])
      pushLines('Equity', report.equity.equity)
      rows.push(['Retained Earnings', '', centsToDollars(report.equity.retainedEarnings_cents)])
      rows.push([
        'Current Period Net Income',
        '',
        centsToDollars(report.equity.currentPeriodNetIncome_cents),
      ])
      rows.push(['Total Equity', '', centsToDollars(report.equity.total_cents)])
      rows.push([])
      rows.push([
        'Total Liabilities + Equity',
        '',
        centsToDollars(report.totalLiabilitiesAndEquity_cents),
      ])
      return rows
    }
  }, [report])

  const isEmpty =
    report &&
    report.assets.current.length === 0 &&
    report.assets.nonCurrent.length === 0 &&
    report.liabilities.current.length === 0 &&
    report.liabilities.longTerm.length === 0 &&
    report.equity.equity.length === 0 &&
    report.equity.retainedEarnings_cents === 0 &&
    report.equity.currentPeriodNetIncome_cents === 0

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Reports', href: '/books/reports' },
          { label: 'Balance Sheet' },
        ]}
        title="Balance Sheet"
        subtitle="Assets, liabilities, and equity as of the chosen date."
      />

      <ReportToolbar
        mode="asOf"
        asOfDate={asOfDate}
        onAsOfDateChange={setAsOfDate}
        loading={loading}
        getCsvRows={csvRows}
        csvFilename={`balance_sheet_${asOfDate}`}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          icon={BookOpen}
          label="Total Assets"
          value={loading ? '—' : formatCurrency(report?.assets.total_cents)}
          loading={loading}
        />
        <KPICard
          label="Total Liabilities"
          value={loading ? '—' : formatCurrency(report?.liabilities.total_cents)}
          loading={loading}
        />
        <KPICard
          label="Total Equity"
          value={loading ? '—' : formatCurrency(report?.equity.total_cents)}
          loading={loading}
        />
        <KPICard
          icon={CheckCircle2}
          label="Balanced"
          value={
            loading ? (
              '—'
            ) : (
              <span className={report?.isBalanced ? 'text-emerald-600' : 'text-red-600'}>
                {report?.isBalanced ? 'Yes' : 'No'}
              </span>
            )
          }
          helper={
            report && !report.isBalanced
              ? 'Run trial balance to investigate.'
              : 'Assets = Liabilities + Equity'
          }
          loading={loading}
        />
      </div>

      {/* Imbalance banner — when assets ≠ liabilities + equity we still
          render the full report below it, so the user can investigate
          without losing the snapshot. */}
      {!loading && report && !report.isBalanced && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200 print:hidden">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p>
              <strong>Balance Sheet is off by{' '}
              {formatCurrency(Math.abs(report.imbalanceCents))}.</strong>
            </p>
            <p className="text-xs">
              Most common cause: an unposted journal entry.{' '}
              <a href="/books/reports/trial-balance" className="underline underline-offset-2">
                Check Trial Balance
              </a>{' '}
              for details.
            </p>
          </div>
        </div>
      )}

      {/* Body */}
      {error ? (
        <EmptyState icon={AlertTriangle} title="Could not load report" description={error} />
      ) : loading ? (
        <SkeletonBlock />
      ) : isEmpty ? (
        <EmptyState
          icon={BookOpen}
          title="No balance sheet activity yet"
          description="Post some opening balances or invoices to see this report come to life."
        />
      ) : report ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Assets column */}
          <Card>
            <CardContent className="p-0">
              <SectionHeader title="Assets" />
              <table className="w-full text-sm">
                <tbody>
                  <SubHeader label="Current assets" />
                  <LineRows lines={report.assets.current} />
                  <SubHeader label="Non-current assets" />
                  <LineRows lines={report.assets.nonCurrent} />
                  <TotalRow label="Total Assets" amount={report.assets.total_cents} emphasis />
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Liabilities + Equity column */}
          <Card>
            <CardContent className="p-0">
              <SectionHeader title="Liabilities & Equity" />
              <table className="w-full text-sm">
                <tbody>
                  <SubHeader label="Current liabilities" />
                  <LineRows lines={report.liabilities.current} />
                  <SubHeader label="Long-term liabilities" />
                  <LineRows lines={report.liabilities.longTerm} />
                  <TotalRow
                    label="Total Liabilities"
                    amount={report.liabilities.total_cents}
                  />
                  <SubHeader label="Equity" />
                  <LineRows lines={report.equity.equity} />
                  <tr className="border-b">
                    <td className="px-4 py-2 pl-8 text-sm">Retained Earnings</td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {formatCurrency(report.equity.retainedEarnings_cents)}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-4 py-2 pl-8 text-sm">Current Period Net Income</td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {formatCurrency(report.equity.currentPeriodNetIncome_cents)}
                    </td>
                  </tr>
                  <TotalRow label="Total Equity" amount={report.equity.total_cents} />
                  <TotalRow
                    label="Total Liabilities + Equity"
                    amount={report.totalLiabilitiesAndEquity_cents}
                    emphasis
                  />
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b bg-muted/40 px-4 py-2.5">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
    </div>
  )
}

function SubHeader({ label }: { label: string }) {
  return (
    <tr className="bg-muted/20">
      <td
        className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        colSpan={2}
      >
        {label}
      </td>
    </tr>
  )
}

function LineRows({ lines }: { lines: BalanceSheetLine[] }) {
  if (lines.length === 0) {
    return (
      <tr>
        <td className="px-4 py-2 pl-8 text-sm text-muted-foreground" colSpan={2}>
          (none)
        </td>
      </tr>
    )
  }
  return (
    <>
      {lines.map((l) => (
        <tr key={l.account_id} className="border-b last:border-b-0">
          <td className="px-4 py-2 pl-8 text-sm">
            <span className="text-muted-foreground">{l.account_code}</span>{' '}
            <span>{l.account_name}</span>
          </td>
          <td className="px-4 py-2 text-right text-sm tabular-nums">
            {formatCurrency(l.amount_cents)}
          </td>
        </tr>
      ))}
    </>
  )
}

function TotalRow({
  label,
  amount,
  emphasis,
}: {
  label: string
  amount: number
  emphasis?: boolean
}) {
  return (
    <tr
      className={
        emphasis
          ? 'border-t-2 border-foreground/70 bg-muted/40'
          : 'border-y bg-foreground/[0.02]'
      }
    >
      <td
        className={`px-4 py-2.5 ${emphasis ? 'font-heading text-base font-semibold' : 'font-semibold'}`}
      >
        {label}
      </td>
      <td
        className={`px-4 py-2.5 text-right tabular-nums ${
          emphasis ? 'font-heading text-base font-semibold' : 'font-semibold'
        }`}
      >
        {formatCurrency(amount)}
      </td>
    </tr>
  )
}

function SkeletonBlock() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
