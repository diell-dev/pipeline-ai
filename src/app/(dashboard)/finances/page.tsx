'use client'

/**
 * Finances Page
 *
 * Full financial overview connected to real invoice data.
 * Features:
 *   - KPI cards: Revenue, Outstanding, Collected, Overdue
 *   - Filters: client, status (paid/unpaid/overdue), date range
 *   - Invoice table with sorting
 *   - Quick actions: mark paid, view job
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SkeletonList } from '@/components/ui/skeleton'
import { KPICard } from '@/components/ui/kpi-card'
import { PageHeader } from '@/components/ui/page-header'
import { toast } from 'sonner'
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  ChevronDown,
  Search,
  Calendar,
  Filter,
  ArrowUpDown,
  Eye,
  Loader2,
  Receipt,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { formatDollars, formatDate } from '@/lib/format'


// Status config for badges — Phase G: paired with dark variants
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  sent: { label: 'Sent', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  partially_paid: { label: 'Partial', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  void: { label: 'Void', className: 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500' },
}

interface InvoiceRow {
  id: string
  invoice_number: string
  job_id: string | null
  client_id: string
  status: string
  // TODO: drop legacy decimal columns once all readers migrated. Cents
  // columns are the source of truth — what Books writes and reports use.
  subtotal_cents: number
  tax_amount_cents: number
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  due_date: string
  paid_date: string | null
  created_at: string
  notes: string | null
  clients: { company_name: string } | null
}

interface FinanceStats {
  revenueThisMonth: number
  revenueLastMonth: number
  outstanding: number
  collected: number
  overdue: number
  totalInvoices: number
  paidCount: number
  unpaidCount: number
  overdueCount: number
}

type SortField = 'created_at' | 'total_amount' | 'due_date' | 'status'
type SortDir = 'asc' | 'desc'
type StatusFilter = '' | 'paid' | 'unpaid' | 'overdue' | 'draft' | 'sent' | 'void'

const PAGE_SIZE = 15

export default function FinancesPage() {
  const router = useRouter()
  const { organization, user } = useAuthStore()
  const isSuperAdmin = user?.role === 'super_admin'

  // Data
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<FinanceStats | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('')
  const [clientFilter, setClientFilter] = useState('')
  const [clientSearch, setClientSearch] = useState('')
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Sorting & pagination
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Clients for filter dropdown
  const [clients, setClients] = useState<{ id: string; company_name: string }[]>([])
  const clientDropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false)
      }
    }
    if (clientDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [clientDropdownOpen])

  // Load clients
  useEffect(() => {
    if (!organization) return
    async function loadClients() {
      const supabase = createClient()
      let q = supabase
        .from('clients')
        .select('id, company_name')
        .is('deleted_at', null)
        .order('company_name')
      if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
      const { data } = await q
      setClients(data || [])
    }
    loadClients()
  }, [organization, isSuperAdmin])

  // Load stats (all active invoices — exclude void and cancelled)
  useEffect(() => {
    if (!organization) return
    async function loadStats() {
      const supabase = createClient()
      // TODO: drop legacy decimal columns once all readers migrated. Cents
      // columns are the source of truth — balance_due_cents is the DB-generated
      // outstanding figure (total_cents − amount_paid_cents) which stays in
      // sync with Books, unlike the legacy `total_amount − paid_amount` expr
      // which went stale on every payment recorded via Books.
      let statsQ = supabase
        .from('invoices')
        .select('status, total_cents, amount_paid_cents, balance_due_cents, due_date, created_at')
        .not('status', 'eq', 'void')
      if (!isSuperAdmin) statsQ = statsQ.eq('organization_id', organization!.id)
      const { data: allInvoices } = await statsQ

      if (!allInvoices) return

      const now = new Date()
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

      // Accumulate in cents — convert to dollars once at the end (the
      // FinanceStats interface is still dollars to keep the KPI cards
      // unchanged; they format via toLocaleString).
      let revenueThisMonthCents = 0
      let revenueLastMonthCents = 0
      let outstandingCents = 0
      let collectedCents = 0
      let overdueCents = 0
      let paidCount = 0
      let unpaidCount = 0
      let overdueCount = 0

      for (const inv of allInvoices) {
        const totalCents = Number(inv.total_cents) || 0
        const paidCents = Number(inv.amount_paid_cents) || 0
        const balanceCents = Number(inv.balance_due_cents) || 0
        const createdAt = new Date(inv.created_at)
        const dueDate = new Date(inv.due_date)

        // Revenue this month (based on invoice creation date)
        if (createdAt >= thisMonthStart) {
          revenueThisMonthCents += totalCents
        }
        if (createdAt >= lastMonthStart && createdAt <= lastMonthEnd) {
          revenueLastMonthCents += totalCents
        }

        if (inv.status === 'paid') {
          collectedCents += paidCents
          paidCount++
        } else {
          outstandingCents += Math.max(0, balanceCents)
          unpaidCount++
          if (dueDate < now && inv.status !== 'draft') {
            overdueCents += Math.max(0, balanceCents)
            overdueCount++
          }
        }
      }

      setStats({
        revenueThisMonth: revenueThisMonthCents / 100,
        revenueLastMonth: revenueLastMonthCents / 100,
        outstanding: outstandingCents / 100,
        collected: collectedCents / 100,
        overdue: overdueCents / 100,
        totalInvoices: allInvoices.filter(i => i.status !== 'void').length,
        paidCount,
        unpaidCount,
        overdueCount,
      })
    }
    loadStats()
  }, [organization, isSuperAdmin])

  // Load filtered invoices
  const loadInvoices = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from('invoices')
      .select('*, clients(company_name)', { count: 'exact' })
    if (!isSuperAdmin) {
      query = query.eq('organization_id', organization.id)
    }

    // Status filter
    if (statusFilter === 'unpaid') {
      query = query.in('status', ['draft', 'sent', 'overdue', 'partially_paid'])
    } else if (statusFilter === 'paid') {
      query = query.eq('status', 'paid')
    } else if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    // Client filter
    if (clientFilter) {
      query = query.eq('client_id', clientFilter)
    }

    // Date range filter
    if (dateFrom) {
      query = query.gte('created_at', `${dateFrom}T00:00:00`)
    }
    if (dateTo) {
      query = query.lte('created_at', `${dateTo}T23:59:59`)
    }

    // Search by invoice number
    if (searchQuery.trim()) {
      query = query.ilike('invoice_number', `%${searchQuery.trim()}%`)
    }

    // Sorting
    query = query.order(sortField, { ascending: sortDir === 'asc' })

    // Pagination
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error, count } = await query.range(from, to)

    if (error) {
      console.error('Failed to load invoices:', error.message)
      toast.error('Failed to load financial data')
    } else {
      setInvoices((data || []) as unknown as InvoiceRow[])
      setTotalCount(count || 0)
    }
    setLoading(false)
  }, [organization, isSuperAdmin, statusFilter, clientFilter, dateFrom, dateTo, searchQuery, sortField, sortDir, page])

  useEffect(() => {
    // `loadInvoices` is a useCallback that flips `loading` on before an async
    // fetch. This is the conventional fetch-on-dependency-change pattern; the
    // rule wants that work moved into an event handler or a data-fetching
    // library (React Query / SWR) — a deliberate future refactor, not a bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInvoices()
  }, [loadInvoices])

  // Filtered client list for dropdown
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients
    const q = clientSearch.toLowerCase()
    return clients.filter((c) => c.company_name.toLowerCase().includes(q))
  }, [clients, clientSearch])

  // Sort toggle
  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
    setPage(0)
  }

  // Reset filters
  function clearFilters() {
    setStatusFilter('')
    setClientFilter('')
    setDateFrom('')
    setDateTo('')
    setSearchQuery('')
    setPage(0)
  }

  const hasActiveFilters = statusFilter || clientFilter || dateFrom || dateTo || searchQuery
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const selectedClientName = clients.find((c) => c.id === clientFilter)?.company_name

  // Revenue change percentage — only show when comparison is meaningful.
  // Skip when the current month just started (< 7 days in) because a near-zero
  // partial month always looks catastrophic vs a full prior month, and skip
  // when last month's baseline was negligible (< $100) so the percent isn't
  // a wild swing off near-zero.
  const dayOfMonth = new Date().getDate()
  const lastMonthBaseline = stats?.revenueLastMonth ?? 0
  const showRevenueChange =
    dayOfMonth >= 7 && lastMonthBaseline >= 100
  const revenueChange = showRevenueChange
    ? Math.round(((stats!.revenueThisMonth - lastMonthBaseline) / lastMonthBaseline) * 100)
    : null
  // Neutral grey unless the change is meaningful (> 20% in either direction).
  const revenueChangeColor =
    revenueChange == null
      ? 'text-muted-foreground'
      : Math.abs(revenueChange) > 20
        ? revenueChange >= 0 ? 'text-green-600' : 'text-red-600'
        : 'text-muted-foreground'

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Finances"
        subtitle="Revenue tracking, payment status, and financial overview."
      />

      {/* KPI Cards — Phase C shared KPICard */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          icon={TrendingUp}
          label="Revenue this month"
          value={formatDollars(stats?.revenueThisMonth || 0)}
          helper={
            revenueChange !== null ? (
              <span className={revenueChangeColor}>
                {revenueChange >= 0 ? '+' : ''}
                {revenueChange}% vs last month
              </span>
            ) : undefined
          }
          trend={
            revenueChange !== null
              ? {
                  value: `${Math.abs(revenueChange)}%`,
                  direction:
                    revenueChange > 0 ? 'up' : revenueChange < 0 ? 'down' : 'flat',
                }
              : undefined
          }
        />

        <KPICard
          icon={Clock}
          label="Outstanding"
          value={
            <span className="text-amber-600">
              {formatDollars(stats?.outstanding || 0)}
            </span>
          }
          helper={`${stats?.unpaidCount || 0} unpaid invoice${
            (stats?.unpaidCount || 0) !== 1 ? 's' : ''
          }`}
        />

        <KPICard
          icon={CheckCircle2}
          label="Collected"
          value={
            <span className="text-emerald-600">
              {formatDollars(stats?.collected || 0)}
            </span>
          }
          helper={`${stats?.paidCount || 0} paid invoice${
            (stats?.paidCount || 0) !== 1 ? 's' : ''
          }`}
        />

        <KPICard
          icon={AlertTriangle}
          label="Overdue"
          value={
            <span className={stats?.overdue ? 'text-red-600' : ''}>
              {formatDollars(stats?.overdue || 0)}
            </span>
          }
          helper={`${stats?.overdueCount || 0} overdue invoice${
            (stats?.overdueCount || 0) !== 1 ? 's' : ''
          }`}
          className={stats?.overdue ? 'ring-red-200' : undefined}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters</span>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Clear all
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(0) }}
              className={`h-9 rounded-md border border-input bg-background px-3 text-sm ${
                statusFilter === '' ? 'text-muted-foreground' : ''
              }`}
            >
              <option value="">All Statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="void">Void</option>
            </select>

            {/* Client filter */}
            <div className="relative" ref={clientDropdownRef}>
              <Button
                variant="outline"
                size="sm"
                className="h-9 min-w-[180px] justify-between font-normal"
                onClick={() => setClientDropdownOpen(!clientDropdownOpen)}
              >
                <span className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={selectedClientName ? '' : 'text-muted-foreground'}>
                    {selectedClientName || 'All Clients'}
                  </span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
              {clientDropdownOpen && (
                <div className="absolute z-50 mt-1 w-[240px] rounded-md border bg-popover shadow-lg">
                  <div className="p-2 border-b">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search clients..."
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="h-8 pl-8 text-sm"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-[220px] overflow-y-auto p-1">
                    <button
                      className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${!clientFilter ? 'font-semibold bg-accent' : ''}`}
                      onClick={() => { setClientFilter(''); setClientDropdownOpen(false); setClientSearch(''); setPage(0) }}
                    >
                      All Clients
                    </button>
                    {filteredClients.map((c) => (
                      <button
                        key={c.id}
                        className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${clientFilter === c.id ? 'font-semibold bg-accent' : ''}`}
                        onClick={() => { setClientFilter(c.id); setClientDropdownOpen(false); setClientSearch(''); setPage(0) }}
                      >
                        {c.company_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(0) }}
                className="h-9 w-[140px] text-sm"
                placeholder="From"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(0) }}
                className="h-9 w-[140px] text-sm"
                placeholder="To"
              />
            </div>

            {/* Search by invoice number */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Invoice #..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
                className="h-9 pl-8 w-[160px] text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Table. UX-SWEEP-#7: /finances is the read-only analytics
          view — Mark Paid / Delete actions live on /invoices. */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Invoices ({totalCount})
            </CardTitle>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => router.push('/invoices')}
            >
              View all in Invoices →
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <SkeletonList rows={5} />
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <DollarSign className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters ? 'No invoices match these filters' : 'No invoices yet'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="md:hidden p-4 space-y-3">
                {invoices.map((inv) => {
                  const statusConf = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft
                  // TODO: drop legacy decimal columns once all readers migrated.
                  // Cents → dollars for the formatDollars helper.
                  const total = (Number(inv.total_cents) || 0) / 100
                  const paid = (Number(inv.amount_paid_cents) || 0) / 100
                  const isOverdue =
                    new Date(inv.due_date) < new Date() &&
                    inv.status !== 'paid' &&
                    inv.status !== 'void' &&
                    inv.status !== 'draft'
                  const displayLabel =
                    isOverdue && inv.status !== 'overdue' ? 'Overdue' : statusConf.label
                  const displayClass =
                    isOverdue && inv.status !== 'overdue'
                      ? STATUS_CONFIG.overdue.className
                      : statusConf.className

                  return (
                    <div
                      key={inv.id}
                      className="rounded-lg border bg-card p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-medium truncate">
                            {inv.invoice_number}
                          </p>
                          <p className="text-sm truncate mt-0.5">
                            {inv.clients?.company_name || '—'}
                          </p>
                        </div>
                        <Badge className={`shrink-0 ${displayClass}`} variant="outline">
                          {displayLabel}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Amount:</span>{' '}
                          <span className="font-medium">
                            {formatDollars(total)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Paid:</span>{' '}
                          {paid > 0 ? (
                            <span className="text-green-600">
                              {formatDollars(paid)}
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                        <div className={isOverdue ? 'text-red-600 font-medium' : ''}>
                          <span className="text-muted-foreground">Due:</span>{' '}
                          {formatDate(inv.due_date)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Created:</span>{' '}
                          {formatDate(inv.created_at)}
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2 border-t">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-10"
                          disabled={!inv.job_id}
                          onClick={() => {
                            if (!inv.job_id) return
                            router.push(`/jobs/${inv.job_id}`)
                          }}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-y">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Invoice</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Client</th>
                      <th
                        className="text-left px-4 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('status')}
                      >
                        <span className="flex items-center gap-1">
                          Status <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th
                        className="text-right px-4 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('total_amount')}
                      >
                        <span className="flex items-center justify-end gap-1">
                          Amount <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Paid</th>
                      <th
                        className="text-right px-4 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('due_date')}
                      >
                        <span className="flex items-center justify-end gap-1">
                          Due Date <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th
                        className="text-right px-4 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground"
                        onClick={() => toggleSort('created_at')}
                      >
                        <span className="flex items-center justify-end gap-1">
                          Created <ArrowUpDown className="h-3 w-3" />
                        </span>
                      </th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const statusConf = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft
                      // TODO: drop legacy decimal columns once all readers migrated.
                      // Cents → dollars for the formatDollars helper.
                      const total = (Number(inv.total_cents) || 0) / 100
                      const paid = (Number(inv.amount_paid_cents) || 0) / 100
                      const balance = (Number(inv.balance_due_cents) || 0) / 100
                      const isOverdue = new Date(inv.due_date) < new Date() && inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'draft'

                      return (
                        <tr key={inv.id} className="border-b hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-medium">{inv.invoice_number}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm">{inv.clients?.company_name || '—'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={isOverdue && inv.status !== 'overdue' ? STATUS_CONFIG.overdue.className : statusConf.className} variant="outline">
                              {isOverdue && inv.status !== 'overdue' ? 'Overdue' : statusConf.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatDollars(total)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {paid > 0 ? (
                              <span className="text-green-600">{formatDollars(paid)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            {formatDate(inv.due_date)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                            {formatDate(inv.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              disabled={!inv.job_id}
                              onClick={() => {
                                if (!inv.job_id) return
                                router.push(`/jobs/${inv.job_id}`)
                              }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      Page {page + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Summary footer */}
      {stats && stats.totalInvoices > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          {stats.totalInvoices} total invoices · {stats.paidCount} paid · {stats.unpaidCount} unpaid · {stats.overdueCount} overdue
        </div>
      )}
    </div>
  )
}
