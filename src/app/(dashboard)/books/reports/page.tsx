'use client'

/**
 * Books → Reports — index page.
 *
 * Grid of cards, one per report. Each card explains in plain language
 * what the report shows AND surfaces a single live KPI (revenue YTD,
 * AR total, etc.) so the buyer sees the numbers without clicking in.
 * Tier + permission gating happens via ReportPageGuard.
 *
 * The previews are fetched in parallel on mount via the same report
 * helpers the detail pages use. Each card shows a skeleton until its
 * number arrives, and degrades to a quiet "—" if its fetch fails — one
 * broken preview should never blank out the index.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen,
  Calculator,
  FileText,
  Landmark,
  Receipt,
  ScrollText,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import {
  getARAging,
  getAPAging,
  getBalanceSheet,
  getCashFlow,
  getProfitAndLoss,
  getSalesTaxSummary,
  getTrialBalance,
} from '@/lib/books/reports'
import { formatCurrency, todayIso } from '@/lib/books/format'

import { ReportPageGuard } from './_components/report-page-guard'

interface ReportCardSpec {
  key: ReportKey
  href: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

type ReportKey =
  | 'pl'
  | 'bs'
  | 'cf'
  | 'tb'
  | 'ar'
  | 'ap'
  | 'gl'
  | 'tax'

const REPORTS: ReportCardSpec[] = [
  {
    key: 'pl',
    href: '/books/reports/profit-loss',
    title: 'Profit & Loss',
    description:
      'Revenue, cost of goods sold, gross profit, operating expenses, and net income for a chosen period.',
    icon: TrendingUp,
  },
  {
    key: 'bs',
    href: '/books/reports/balance-sheet',
    title: 'Balance Sheet',
    description:
      'Snapshot of what the business owns, owes, and is worth — assets, liabilities, and equity as of a date.',
    icon: BookOpen,
  },
  {
    key: 'cf',
    href: '/books/reports/cash-flow',
    title: 'Cash Flow',
    description:
      'How net income translates to cash, with working-capital adjustments for AR, AP, and depreciation.',
    icon: Wallet,
  },
  {
    key: 'ar',
    href: '/books/reports/ar-aging',
    title: 'AR Aging',
    description:
      'Outstanding customer invoices bucketed by how long they have been past due — current, 1-30, 31-60, 61-90, 90+.',
    icon: Receipt,
  },
  {
    key: 'ap',
    href: '/books/reports/ap-aging',
    title: 'AP Aging',
    description:
      'Outstanding vendor bills bucketed by how long they have been past due, so you know who to pay first.',
    icon: FileText,
  },
  {
    key: 'tb',
    href: '/books/reports/trial-balance',
    title: 'Trial Balance',
    description:
      'Every account with its total debits and credits — proves the books balance before closing the period.',
    icon: Calculator,
  },
  {
    key: 'gl',
    href: '/books/reports/general-ledger',
    title: 'General Ledger',
    description:
      'Drill into every posted journal entry with running balances. Filter by account for an account history.',
    icon: ScrollText,
  },
  {
    key: 'tax',
    href: '/books/reports/sales-tax',
    title: 'Sales Tax Summary',
    description:
      'Per-rate breakdown of tax collected vs paid, so filing the return is a copy-paste.',
    icon: Landmark,
  },
]

interface Preview {
  label: string
  value: string
  /** Optional tone hint — defaults to muted. */
  tone?: 'muted' | 'good' | 'warn'
}

type PreviewMap = Partial<Record<ReportKey, Preview>>

export default function BooksReportsIndexPage() {
  return (
    <ReportPageGuard>
      <BooksReportsIndexInner />
    </ReportPageGuard>
  )
}

function BooksReportsIndexInner() {
  const { organization } = useAuthStore()
  const [previews, setPreviews] = useState<PreviewMap>({})
  const [loading, setLoading] = useState(true)

  const loadPreviews = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    const supabase = createClient()
    const orgId = organization.id
    const asOf = todayIso()

    // Use the org's most recent accounting period for YTD windows. If
    // none is configured we fall back to "current calendar year" so the
    // page still renders something useful.
    let periodStart = `${new Date().getFullYear()}-01-01`
    let periodEnd = asOf
    try {
      const { data: periods } = await supabase
        .from('accounting_periods')
        .select('start_date, end_date')
        .eq('organization_id', orgId)
        .order('start_date', { ascending: false })
        .limit(1)
      const latest = (periods ?? [])[0] as
        | { start_date: string; end_date: string }
        | undefined
      if (latest?.start_date) {
        // YTD from the START of the latest period's fiscal year, not its
        // own start — so monthly periods don't collapse the window.
        const m = /^(\d{4})/.exec(latest.start_date)
        if (m) periodStart = `${m[1]}-01-01`
        if (latest.end_date > asOf) periodEnd = asOf
        else periodEnd = latest.end_date
        if (periodEnd < asOf) periodEnd = asOf
      }
    } catch {
      // ignore — fall through to calendar-year default
    }

    // Fan out all eight report queries in parallel. Each one wraps its
    // own try/catch so one slow / broken report doesn't block the rest.
    const tasks: Array<Promise<{ key: ReportKey; preview: Preview }>> = [
      (async () => {
        try {
          const pl = await getProfitAndLoss(supabase, orgId, periodStart, periodEnd)
          return {
            key: 'pl' as const,
            preview: {
              label: 'Net income YTD',
              value: formatCurrency(pl.netIncome.amount_cents),
              tone: pl.netIncome.amount_cents >= 0 ? 'good' : 'warn',
            },
          }
        } catch {
          return { key: 'pl' as const, preview: { label: 'Net income YTD', value: '—' } }
        }
      })(),
      (async () => {
        try {
          const bs = await getBalanceSheet(supabase, orgId, asOf)
          return {
            key: 'bs' as const,
            preview: {
              label: 'Total assets',
              value: formatCurrency(bs.assets.total_cents),
            },
          }
        } catch {
          return { key: 'bs' as const, preview: { label: 'Total assets', value: '—' } }
        }
      })(),
      (async () => {
        try {
          const cf = await getCashFlow(supabase, orgId, periodStart, periodEnd)
          return {
            key: 'cf' as const,
            preview: {
              label: 'Operating cash flow YTD',
              value: formatCurrency(cf.operating.operatingCashFlow_cents),
              tone: cf.operating.operatingCashFlow_cents >= 0 ? 'good' : 'warn',
            },
          }
        } catch {
          return {
            key: 'cf' as const,
            preview: { label: 'Operating cash flow YTD', value: '—' },
          }
        }
      })(),
      (async () => {
        try {
          const tb = await getTrialBalance(supabase, orgId, asOf)
          const off = Math.abs(tb.totals.debits_cents - tb.totals.credits_cents)
          if (tb.totals.isBalanced) {
            return {
              key: 'tb' as const,
              preview: { label: 'Status', value: 'Balanced', tone: 'good' },
            }
          }
          return {
            key: 'tb' as const,
            preview: {
              label: 'Status',
              value: `Off by ${formatCurrency(off)}`,
              tone: 'warn',
            },
          }
        } catch {
          return { key: 'tb' as const, preview: { label: 'Status', value: '—' } }
        }
      })(),
      (async () => {
        try {
          const ar = await getARAging(supabase, orgId, asOf)
          return {
            key: 'ar' as const,
            preview: {
              label: 'Outstanding',
              value: formatCurrency(ar.totals.total_cents),
              tone: ar.totals.days_90_plus_cents > 0 ? 'warn' : 'muted',
            },
          }
        } catch {
          return { key: 'ar' as const, preview: { label: 'Outstanding', value: '—' } }
        }
      })(),
      (async () => {
        try {
          const ap = await getAPAging(supabase, orgId, asOf)
          return {
            key: 'ap' as const,
            preview: {
              label: 'Payable',
              value: formatCurrency(ap.totals.total_cents),
              tone: ap.totals.days_90_plus_cents > 0 ? 'warn' : 'muted',
            },
          }
        } catch {
          return { key: 'ap' as const, preview: { label: 'Payable', value: '—' } }
        }
      })(),
      (async () => {
        try {
          // Lightweight count for the GL preview — avoid pulling every
          // line into the index.
          const { count } = await supabase
            .from('journal_entries')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .is('deleted_at', null)
            .not('posted_at', 'is', null)
            .gte('entry_date', periodStart)
            .lte('entry_date', periodEnd)
          return {
            key: 'gl' as const,
            preview: {
              label: 'Entries YTD',
              value: `${(count ?? 0).toLocaleString('en-US')}`,
            },
          }
        } catch {
          return { key: 'gl' as const, preview: { label: 'Entries YTD', value: '—' } }
        }
      })(),
      (async () => {
        try {
          const tx = await getSalesTaxSummary(supabase, orgId, periodStart, periodEnd)
          return {
            key: 'tax' as const,
            preview: {
              label: 'Tax owed YTD',
              value: formatCurrency(tx.totals.net_tax_owed_cents),
            },
          }
        } catch {
          return { key: 'tax' as const, preview: { label: 'Tax owed YTD', value: '—' } }
        }
      })(),
    ]

    // settle one-at-a-time so each card lights up as soon as its number
    // is ready (instead of waiting for the slowest report).
    for (const t of tasks) {
      t.then(({ key, preview }) => {
        setPreviews((prev) => ({ ...prev, [key]: preview }))
      }).catch(() => {})
    }
    await Promise.allSettled(tasks)
    setLoading(false)
  }, [organization])

  // Defer the loader to the next microtask so the setState calls inside
  // `loadPreviews` don't fire synchronously inside the effect body — this
  // is what keeps `react-hooks/set-state-in-effect` happy (matches the
  // pattern in /books/page.tsx).
  useEffect(() => {
    void Promise.resolve().then(loadPreviews)
  }, [loadPreviews])

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Reports' },
        ]}
        title="Financial Reports"
        subtitle="GAAP-style statements computed from your journal entries — pick a report to drill in."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon
          const preview = previews[r.key]
          return (
            <Link
              key={r.href}
              href={r.href}
              className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-[box-shadow,transform] duration-150 ease-out-strong [@media(hover:hover)_and_(pointer:fine)]:group-hover:shadow-md motion-safe:group-active:scale-[0.995]">
                <CardContent className="space-y-2 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground/80 ring-1 ring-border">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <PreviewBadge preview={preview} loading={loading && !preview} />
                  </div>
                  <h3 className="font-heading text-base font-semibold tracking-tight text-foreground">
                    {r.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{r.description}</p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function PreviewBadge({
  preview,
  loading,
}: {
  preview: Preview | undefined
  loading: boolean
}) {
  if (loading || !preview) {
    return (
      <div className="space-y-1 text-right">
        <Skeleton className="h-3 w-20 ml-auto" />
        <Skeleton className="h-5 w-24 ml-auto" />
      </div>
    )
  }
  const toneClass =
    preview.tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : preview.tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-foreground'
  return (
    <div className="space-y-0.5 text-right">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {preview.label}
      </p>
      <p className={`text-sm font-semibold tabular-nums ${toneClass}`}>
        {preview.value}
      </p>
    </div>
  )
}
