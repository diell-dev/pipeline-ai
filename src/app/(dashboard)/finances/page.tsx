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
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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

// Status config for badges
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-600' },
  sent: { label: 'Sent', className: 'bg-blue-100 text-blue-700' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-700' },
  partially_paid: { label: 'Partial', className: 'bg-amber-100 text-amber-700' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700' },
  void: { label: 'Void', className: 'bg-zinc-100 text-zinc-400' },
}

interface InvoiceRow {
  id: string
  invoice_number: string
  job_id: string
  client_id: string
  status: string
  amount: number
  tax_amount: number
  total_amount: number
  paid_amount: number
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
  const { organization } = useAuthStore()

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
      const { data } = await supabase
        .from('clients')
        .select('id, company_name')
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('company_name')
      setClients(data || [])
    }
    loadClients()
  }, [organization])

  // Load stats (all invoices, unfiltered)
  useEffect(() => {
    if (!organization) return
    async function loadStats() {
      const supabase = createClient()
      const { data: allInvoices } = await supabase
        .from('invoices')
        .select('status, total_amount, paid_amount, due_date, created_at')
        .eq('organization_id', organization!.id)

      if (!allInvoices) return

      const now = new Date()
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

      let revenueThisMonth = 0
      let revenueLastMonth = 0
      let outstanding = 0
      let collected = 0
      let overdue = 0
      let paidCount = 0
      let unpaidCount = 0
      let overdueCount = 0

      for (const inv of allInvoices) {
        const total = Number(inv.total_amount) || 0
        const paid = Number(inv.paid_amount) || 0
        const createdAt = new Date(inv.created_at)
        const dueDate = new Date(inv.due_date)

        // Revenue this month (based on invoice creation date)
        if (createdAt >= thisMonthStart) {
          revenueThisMonth += total
        }
        if (createdAt >= lastMonthStart && createdAt <= lastMonthEnd) {
          revenueLastMonth += total
        }

        if (inv.status === 'paid') {
          collected += paid
          paidCount++
        } else if (inv.status === 'void') {
          // skip
        } else {
          outstanding += total - paid
          unpaidCount++
          if (dueDate < now && inv.status !== 'draft') {
            overdue += total - paid
            overdueCount++
          }
        }
      }

      setStats({
        revenueThisMonth,
        revenueLastMonth,
        outstanding,
        collected,
        overdue,
        totalInvoices: allInvoices.length,
        paidCount,
        unpaidCount,
        overdueCount,
      })
    }
    loadStats()
  }, [organization])

  // Load filtered invoices
  useEffect(() => {
    if (!organization) return
    async function loadInvoices() {
      setLoading(true)
      const supabase = createClient()

      let query = supabase
        .from('invoices')
        .select('*, clients(company_name)', { count: 'exact' })
        .eq('organization_id', organization!.id)

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
    }
    loadInvoices()
  }, [organization, statusFilter, clientFilter, dateFrom, dateTo, searchQuery, sortField, sortDir, page])

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

  // Revenue change percentage
  const revenueChange = stats?.revenueLastMonth
    ? Math.round(((stats.revenueThisMonth - stats.revenueLastMonth) / stats.revenueLastMonth) * 100)
    : null

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finances</h1>
        <p className="text-muted-foreground text-sm">
          Revenue tracking, payment status, and financial overview.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">Revenue This Month</span>
            </div>
            <p className="text-2xl font-bold">
              ${(stats?.revenueThisMonth || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            {revenueChange !== null && (
              <p className={`text-xs mt-1 ${revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {revenueChange >= 0 ? '+' : ''}{revenueChange}% vs last month
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-4 w-4" />
              <span className="text-xs font-medium">Outstanding</span>
            </div>
            <p className="text-2xl font-bold text-amber-600">
              ${(stats?.outstanding || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.unpaidCount || 0} unpaid invoice{(stats?.unpaidCount || 0) !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Collected</span>
            </div>
            <p className="text-2xl font-bold text-green-600">
              ${(stats?.collected || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.paidCount || 0} paid invoice{(stats?.paidCount || 0) !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card className={stats?.overdue ? 'border-red-200 bg-red-50/30' : ''}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-medium">Overdue</span>
            </div>
            <p className={`text-2xl font-bold ${stats?.overdue ? 'text-red-600' : ''}`}>
              ${(stats?.overdue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.overdueCount || 0} overdue invoice{(stats?.overdueCount || 0) !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
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
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
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
                  {selectedClientName || 'All Clients'}
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

      {/* Invoice Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Invoices ({totalCount})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 border-y">
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
                      const total = Number(inv.total_amount) || 0
                      const paid = Number(inv.paid_amount) || 0
                      const balance = total - paid
                      const isOverdue = new Date(inv.due_date) < new Date() && inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'draft'

                      return (
                        <tr key={inv.id} className="border-b hover:bg-zinc-50/50 transition-colors">
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
                            ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {paid > 0 ? (
                              <span className="text-green-600">${paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                            {new Date(inv.due_date).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                            {new Date(inv.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => router.push(`/jobs/${inv.job_id}`)}
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
