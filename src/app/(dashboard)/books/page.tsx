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
import { currentMonthRange, fmt } from '@/lib/books/format-helpers'
import {
  TrendingUp, TrendingDown, Wallet, FileText, ReceiptText,
  CreditCard, Banknote, BookOpen, ArrowRight,
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

export default function BooksDashboardPage() {
  const { organization } = useAuthStore()
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)

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

    const { start, end } = currentMonthRange()

    // 2. Revenue + expense entries for the current month — read via the
    //    journal_entry_lines + chart_of_accounts join.
    const [accountsRes, entriesRes, monthLinesRes, recentEntriesRes] = await Promise.all([
      supabase
        .from('chart_of_accounts')
        .select('id, type, subtype, code')
        .eq('organization_id', organization.id)
        .is('deleted_at', null),

      // current-month posted JE ids
      supabase
        .from('journal_entries')
        .select('id')
        .eq('organization_id', organization.id)
        .gte('entry_date', start)
        .lte('entry_date', end)
        .is('deleted_at', null)
        .not('posted_at', 'is', null),

      // last-180-days entries for the chart
      supabase
        .from('journal_entries')
        .select('id, entry_date')
        .eq('organization_id', organization.id)
        .gte('entry_date', isoDaysAgo(180))
        .is('deleted_at', null)
        .not('posted_at', 'is', null),

      supabase
        .from('journal_entries')
        .select('id, entry_number, entry_date, description, source_type, source_id, posted_at')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .not('posted_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    const accounts = (accountsRes.data ?? []) as Array<{
      id: string; type: string; subtype: string; code: string
    }>
    const accountById = new Map(accounts.map((a) => [a.id, a]))

    const arAccount = accounts.find((a) => a.code === '1100')
    const apAccount = accounts.find((a) => a.code === '2000')
    const cashAccountIds = accounts
      .filter((a) => a.subtype === 'cash' || a.subtype === 'bank')
      .map((a) => a.id)

    const monthEntryIds = (entriesRes.data ?? []).map((e) => (e as { id: string }).id)
    const recentEntries = (recentEntriesRes.data ?? []) as RecentEntry[]

    // Now load JE lines for the relevant entry sets.
    let monthRevenue = 0
    let monthExpenses = 0
    if (monthEntryIds.length > 0) {
      const { data } = await supabase
        .from('journal_entry_lines')
        .select('account_id, debit_cents, credit_cents')
        .in('journal_entry_id', monthEntryIds)
      for (const l of (data ?? []) as Array<{
        account_id: string; debit_cents: number; credit_cents: number
      }>) {
        const acct = accountById.get(l.account_id)
        if (!acct) continue
        if (acct.type === 'income') monthRevenue += l.credit_cents - l.debit_cents
        if (acct.type === 'expense') monthExpenses += l.debit_cents - l.credit_cents
      }
    }

    // Outstanding AR / AP — sum balances on those accounts (debit-credit).
    let outstandingAR = 0
    let outstandingAP = 0
    let cashOnHand = 0
    const monetaryAccountIds = [
      ...(arAccount ? [arAccount.id] : []),
      ...(apAccount ? [apAccount.id] : []),
      ...cashAccountIds,
    ]
    if (monetaryAccountIds.length > 0) {
      const { data } = await supabase
        .from('journal_entry_lines')
        .select(
          'account_id, debit_cents, credit_cents, journal_entry:journal_entry_id (organization_id, deleted_at, posted_at)'
        )
        .in('account_id', monetaryAccountIds)
      // Supabase types the joined relation as an array even when the FK
      // is single-valued, so we accept both shapes and normalize.
      type LineRow = {
        account_id: string
        debit_cents: number
        credit_cents: number
        journal_entry:
          | { organization_id: string; deleted_at: string | null; posted_at: string | null }
          | { organization_id: string; deleted_at: string | null; posted_at: string | null }[]
          | null
      }
      for (const l of (data ?? []) as unknown as LineRow[]) {
        const parent = Array.isArray(l.journal_entry) ? l.journal_entry[0] : l.journal_entry
        if (!parent || parent.deleted_at || !parent.posted_at) continue
        if (parent.organization_id !== organization.id) continue
        if (arAccount && l.account_id === arAccount.id) {
          outstandingAR += l.debit_cents - l.credit_cents
        } else if (apAccount && l.account_id === apAccount.id) {
          outstandingAP += l.credit_cents - l.debit_cents
        } else if (cashAccountIds.includes(l.account_id)) {
          cashOnHand += l.debit_cents - l.credit_cents
        }
      }
    }

    setKpis({
      revenueMonth: monthRevenue,
      expensesMonth: monthExpenses,
      netMonth: monthRevenue - monthExpenses,
      outstandingAR,
      outstandingAP,
      cashOnHand,
    })

    setRecent(recentEntries)

    // Build the 6-month series.
    const monthIds = ((monthLinesRes.data ?? []) as Array<{ id: string; entry_date: string }>)
    const idToDate = new Map(monthIds.map((m) => [m.id, m.entry_date]))
    let monthlyLines: Array<{
      journal_entry_id: string; account_id: string; debit_cents: number; credit_cents: number
    }> = []
    if (monthIds.length > 0) {
      const { data } = await supabase
        .from('journal_entry_lines')
        .select('journal_entry_id, account_id, debit_cents, credit_cents')
        .in('journal_entry_id', monthIds.map((m) => m.id))
      monthlyLines = (data ?? []) as typeof monthlyLines
    }

    const buckets = new Map<string, { revenue: number; expenses: number }>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const key = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`
      buckets.set(key, { revenue: 0, expenses: 0 })
    }
    for (const line of monthlyLines) {
      const acct = accountById.get(line.account_id)
      if (!acct) continue
      const date = idToDate.get(line.journal_entry_id)
      if (!date) continue
      const key = date.slice(0, 7) // YYYY-MM
      const bucket = buckets.get(key)
      if (!bucket) continue
      if (acct.type === 'income') bucket.revenue += line.credit_cents - line.debit_cents
      if (acct.type === 'expense') bucket.expenses += line.debit_cents - line.credit_cents
    }
    const monthlyData: MonthlyPoint[] = Array.from(buckets.entries()).map(([k, v]) => {
      const [y, m] = k.split('-').map(Number)
      const label = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' })
      return { label, revenue: v.revenue, expenses: v.expenses }
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
        <Link href="/books/banking">
          <Button variant="outline"><Banknote className="mr-2 h-4 w-4" />Reconcile bank</Button>
        </Link>
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

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return fmt(d)
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
