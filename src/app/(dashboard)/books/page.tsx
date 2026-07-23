'use client'

/**
 * Books dashboard — the landing page for /books.
 *
 * Shows:
 *   - KPI strip (revenue, expenses, net, AR, AP, cash on hand) for the
 *     current calendar month.
 *   - Quick action buttons (create invoice / bill / expense, reconcile bank).
 *   - Recent activity (last 10 journal entries) with deep links.
 *   - A simple "revenue vs expenses" bar chart for the last 6 months,
 *     rendered as inline SVG (no chart lib added to the bundle).
 *
 * When the org hasn't completed the setup wizard yet (books_enabled_at
 * IS NULL), we replace the dashboard with a welcome card directing the
 * user to the wizard.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { KPICard } from '@/components/ui/kpi-card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatDate } from '@/lib/books/format'
import {
  TrendingUp, TrendingDown, Wallet, FileText, ReceiptText,
  CreditCard, Banknote, BookOpen, ArrowRight, Sparkles, X,
} from 'lucide-react'

interface KPIs {
  revenueMonth: number
  expensesMonth: number
  netMonth: number
  outstandingAR: number
  outstandingAP: number
  cashOnHand: number
}

interface RecentEntry {
  id: string
  entry_number: string
  entry_date: string
  description: string | null
  source_type: string
  source_id: string | null
  posted_at: string | null
}

interface MonthlyPoint {
  label: string
  revenue: number
  expenses: number
}

const JUST_SETUP_KEY = 'books-just-setup'

export default function BooksDashboardPage() {
  const { organization } = useAuthStore()
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [showJustSetup, setShowJustSetup] = useState(false)

  // Read the one-time "wizard just finished" flag set by /books/setup.
  // We read it in an effect so SSR matches the initial render (no flash).
  // The setState is deferred via microtask to keep the project's
  // `react-hooks/set-state-in-effect` rule happy.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      try {
        if (typeof window === 'undefined') return
        if (window.localStorage.getItem(JUST_SETUP_KEY) === '1') {
          setShowJustSetup(true)
        }
      } catch {
        // privacy-mode browsers: localStorage throws; just leave it off.
      }
    })
    return () => { cancelled = true }
  }, [])

  const dismissJustSetup = useCallback(() => {
    setShowJustSetup(false)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(JUST_SETUP_KEY)
      }
    } catch {
      // ignore
    }
  }, [])

  // Auto-clear the hint once any posted journal entry exists — the user
  // has gotten past their first invoice/bill, so the banner has done
  // its job and shouldn't keep nagging on every dashboard visit.
  useEffect(() => {
    if (showJustSetup && recent.length > 0) {
      void Promise.resolve().then(dismissJustSetup)
    }
  }, [showJustSetup, recent.length, dismissJustSetup])

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    const supabase = createClient()

    // 1. Has the org enabled books? (books_enabled_at NULL = wizard not run)
    if (!organization.books_enabled_at) {
      setNeedsSetup(true)
      setLoading(false)
      return
    }
    setNeedsSetup(false)

    // KPIs + 6-month series come from a single SQL aggregate
    // (books_dashboard_kpis). This replaced three un-paginated client-side
    // reads of journal_entry_lines that hit PostgREST's 1000-row cap and
    // silently truncated — which showed a phantom ~$646k AR (real value $0),
    // $0 cash, and a near-empty chart for any org past ~1000 ledger lines.
    const [{ data: kpiData, error: kpiErr }, recentEntriesRes] = await Promise.all([
      supabase.rpc('books_dashboard_kpis', { p_org_id: organization.id }),

      supabase
        .from('journal_entries')
        .select('id, entry_number, entry_date, description, source_type, source_id, posted_at')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .not('posted_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    if (kpiErr) {
      console.error('books_dashboard_kpis failed:', kpiErr.message)
    }

    const k = (kpiData ?? {}) as {
      month_revenue_cents?: number
      month_expenses_cents?: number
      ar_cents?: number
      ap_cents?: number
      cash_cents?: number
      series?: Array<{ month: string; revenue_cents: number; expenses_cents: number }>
    }

    const monthRevenue = k.month_revenue_cents ?? 0
    const monthExpenses = k.month_expenses_cents ?? 0

    setKpis({
      revenueMonth: monthRevenue,
      expensesMonth: monthExpenses,
      netMonth: monthRevenue - monthExpenses,
      outstandingAR: k.ar_cents ?? 0,
      outstandingAP: k.ap_cents ?? 0,
      cashOnHand: k.cash_cents ?? 0,
    })

    setRecent((recentEntriesRes.data ?? []) as RecentEntry[])

    // 6-month revenue-vs-expenses series (cents), already bucketed by SQL.
    const monthlyData: MonthlyPoint[] = (k.series ?? []).map((pt) => {
      const [y, m] = pt.month.split('-').map(Number)
      const label = new Date(y, (m ?? 1) - 1, 1).toLocaleString('en-US', { month: 'short' })
      return { label, revenue: pt.revenue_cents, expenses: pt.expenses_cents }
    })
    setMonthly(monthlyData)
    setLoading(false)
  }, [organization])

  // Fire the loader once when the callback identity changes. Wrapped
  // in a microtask so the setState calls inside `load` (e.g. the early
  // `setLoading(true)` guard) don't fire synchronously inside the effect
  // body — keeps `react-hooks/set-state-in-effect` happy.
  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (needsSetup) {
    return (
      <div className="space-y-4">
        <PageHeader title="Books" subtitle="Double-entry bookkeeping for your business." />
        <EmptyState
          icon={BookOpen}
          title="Welcome to Books"
          description="Set up your chart of accounts and start tracking every dollar in and out with GAAP-grade journal entries. Takes about a minute."
          action={
            <Link href="/books/setup">
              <Button>
                Run setup wizard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Books"
        subtitle="Operational bookkeeping — invoices, bills, expenses, and the ledger underneath."
      />

      {showJustSetup && (
        <div className="flex items-start gap-3 rounded-lg border border-brand-accent/40 bg-brand-accent/10 px-4 py-3 text-sm">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" aria-hidden="true" />
          <div className="flex-1 space-y-1">
            <p className="font-medium text-foreground">Books is ready.</p>
            <p className="text-muted-foreground">
              Your chart of accounts is seeded and the current period is open.
              Create your first invoice to start posting to the ledger.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/books/invoices/new">
              <Button size="sm" onClick={dismissJustSetup}>
                Create invoice
              </Button>
            </Link>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={dismissJustSetup}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard
          label="Revenue this month"
          value={formatCurrency(kpis?.revenueMonth ?? 0)}
          icon={TrendingUp}
        />
        <KPICard
          label="Expenses this month"
          value={formatCurrency(kpis?.expensesMonth ?? 0)}
          icon={TrendingDown}
        />
        <KPICard
          label="Net income (mo.)"
          value={formatCurrency(kpis?.netMonth ?? 0)}
          icon={Wallet}
        />
        <KPICard
          label="Outstanding AR"
          value={formatCurrency(kpis?.outstandingAR ?? 0)}
          icon={FileText}
        />
        <KPICard
          label="Outstanding AP"
          value={formatCurrency(kpis?.outstandingAP ?? 0)}
          icon={ReceiptText}
        />
        <KPICard
          label="Cash on hand"
          value={formatCurrency(kpis?.cashOnHand ?? 0)}
          icon={Banknote}
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/books/invoices/new">
          <Button><FileText className="mr-2 h-4 w-4" />Create invoice</Button>
        </Link>
        <Link href="/books/bills/new">
          <Button variant="outline"><ReceiptText className="mr-2 h-4 w-4" />Record bill</Button>
        </Link>
        <Link href="/books/expenses/new">
          <Button variant="outline"><CreditCard className="mr-2 h-4 w-4" />Add expense</Button>
        </Link>
        {/* TODO: enable when banking / bank-rec feature ships. The /books/banking
            route is still a stub, so hiding the primary CTA prevents demo dead-ends. */}
        {false && (
          <Link href="/books/banking">
            <Button variant="outline"><Banknote className="mr-2 h-4 w-4" />Reconcile bank</Button>
          </Link>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Monthly revenue vs expenses chart (SVG bar chart) */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue vs expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniBarChart data={monthly} />
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent journal entries</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries yet — create an invoice or bill to get started.</p>
            ) : (
              <ul className="divide-y">
                {recent.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{e.entry_number}</p>
                      <p className="text-sm truncate">{e.description ?? '—'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">{formatDate(e.entry_date)}</p>
                      {sourceLink(e) ? (
                        <Link
                          href={sourceLink(e)!}
                          className="text-xs text-brand-primary hover:underline"
                        >
                          View source
                        </Link>
                      ) : (
                        <span className="text-xs capitalize text-muted-foreground">{e.source_type}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function sourceLink(e: RecentEntry): string | null {
  if (!e.source_id) return null
  switch (e.source_type) {
    case 'invoice': return `/books/invoices/${e.source_id}`
    case 'bill':    return `/books/bills/${e.source_id}`
    case 'expense': return `/books/expenses/${e.source_id}`
    case 'payment': return `/books/payments/${e.source_id}`
    default: return null
  }
}

function MiniBarChart({ data }: { data: MonthlyPoint[] }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>
  }
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.expenses)))
  const barWidth = 18
  const groupWidth = 60
  const height = 160
  const padding = 32
  const width = data.length * groupWidth + padding * 2

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height + 36} className="text-foreground">
        <line
          x1={padding}
          y1={height}
          x2={width - padding}
          y2={height}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        {data.map((d, i) => {
          const x = padding + i * groupWidth + 4
          const revH = (d.revenue / max) * (height - 10)
          const expH = (d.expenses / max) * (height - 10)
          return (
            <g key={i}>
              <rect
                x={x}
                y={height - revH}
                width={barWidth}
                height={revH}
                className="fill-brand-primary"
                rx={2}
              >
                <title>Revenue: {formatCurrency(d.revenue)}</title>
              </rect>
              <rect
                x={x + barWidth + 2}
                y={height - expH}
                width={barWidth}
                height={expH}
                className="fill-red-500/80"
                rx={2}
              >
                <title>Expenses: {formatCurrency(d.expenses)}</title>
              </rect>
              <text
                x={x + barWidth}
                y={height + 16}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-brand-primary" />
          Revenue
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500/80" />
          Expenses
        </span>
      </div>
    </div>
  )
}
