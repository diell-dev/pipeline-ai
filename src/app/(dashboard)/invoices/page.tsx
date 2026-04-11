'use client'

/**
 * Invoices Page
 *
 * Shows all invoices for the organization with:
 * - Real data from the invoices table
 * - Pagination (15 per page)
 * - Searchable client filter dropdown
 * - Status badges (paid, unpaid, overdue, etc.)
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import type { InvoiceStatus, Client } from '@/types/database'

interface InvoiceRow {
  id: string
  invoice_number: string
  amount: number
  tax_amount: number
  total_amount: number
  status: InvoiceStatus
  due_date: string
  paid_date: string | null
  paid_amount: number
  created_at: string
  client_id: string
  job_id: string
  clients: { company_name: string } | null
}

const STATUS_STYLES: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-700' },
  sent: { label: 'Sent', className: 'bg-blue-100 text-blue-700' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-700' },
  partially_paid: { label: 'Partial', className: 'bg-amber-100 text-amber-700' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700' },
  void: { label: 'Void', className: 'bg-zinc-100 text-zinc-500 line-through' },
}

const PAGE_SIZE = 15

export default function InvoicesPage() {
  const { organization, user } = useAuthStore()
  const searchParams = useSearchParams()
  const canDeleteInvoice = user?.role ? hasPermission(user.role, 'invoices:delete') : false

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null)

  // Filter
  const clientIdFromParam = searchParams.get('client')
  const statusFromParam = searchParams.get('status')
  const [selectedClientId, setSelectedClientId] = useState<string>(clientIdFromParam || '')
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>((statusFromParam as InvoiceStatus) || '')

  // Load clients for filter
  useEffect(() => {
    if (!organization) return

    async function loadClients() {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('company_name')

      setClients(data || [])

      // If client filter is in query param, set the display name
      if (clientIdFromParam && data) {
        const client = data.find((c) => c.id === clientIdFromParam)
        if (client) {
          setClientSearch(client.company_name)
        }
      }
    }

    loadClients()
  }, [organization, clientIdFromParam])

  // Load invoices
  useEffect(() => {
    if (!organization) return

    async function loadInvoices() {
      setLoading(true)
      const supabase = createClient()

      let query = supabase
        .from('invoices')
        .select('*, clients(company_name)', { count: 'exact' })
        .eq('organization_id', organization!.id)
        .order('created_at', { ascending: false })

      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId)
      }

      if (statusFilter === 'unpaid' as string) {
        // Special "unpaid" filter: show draft, sent, overdue, partially_paid
        query = query.in('status', ['draft', 'sent', 'overdue', 'partially_paid'])
      } else if (statusFilter) {
        query = query.eq('status', statusFilter)
      }

      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data, error, count } = await query.range(from, to)

      if (error) {
        console.error('Failed to load invoices:', error.message)
        toast.error('Failed to load invoices')
      } else {
        setInvoices((data || []) as unknown as InvoiceRow[])
        setTotalCount(count || 0)
      }
      setLoading(false)
    }

    loadInvoices()
  }, [organization, page, selectedClientId, statusFilter])

  // Filtered client list for dropdown
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients
    const q = clientSearch.toLowerCase()
    return clients.filter((c) => c.company_name.toLowerCase().includes(q))
  }, [clients, clientSearch])

  // Stats
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  function selectClient(clientId: string, clientName: string) {
    setSelectedClientId(clientId)
    setClientSearch(clientName)
    setShowClientDropdown(false)
    setPage(0) // Reset to first page
  }

  function clearClientFilter() {
    setSelectedClientId('')
    setClientSearch('')
    setPage(0)
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  async function handleVoidInvoice(invoiceId: string) {
    setVoidingId(invoiceId)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/delete`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to void invoice')
      toast.success(`Invoice ${data.invoice_number} voided`)
      // Refresh the list
      setInvoices((prev) => prev.map((inv) =>
        inv.id === invoiceId ? { ...inv, status: 'void' as InvoiceStatus } : inv
      ))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
    } finally {
      setVoidingId(null)
      setConfirmVoidId(null)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground text-sm hidden sm:block">
          Track invoices, payment status, and outstanding balances.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by client..."
            value={clientSearch}
            onChange={(e) => {
              setClientSearch(e.target.value)
              setShowClientDropdown(true)
              if (!e.target.value) {
                setSelectedClientId('')
                setPage(0)
              }
            }}
            onFocus={() => setShowClientDropdown(true)}
            className="pl-9 pr-8 h-9"
          />
          {selectedClientId && (
            <button
              onClick={clearClientFilter}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {showClientDropdown && filteredClients.length > 0 && !selectedClientId && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-48 overflow-auto">
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c.id, c.company_name)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 transition-colors"
                >
                  {c.company_name}
                </button>
              ))}
            </div>
          )}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter((e.target.value as InvoiceStatus) || '')
            setPage(0)
          }}
          className="flex h-9 rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="partially_paid">Partially Paid</option>
          <option value="overdue">Overdue</option>
          <option value="void">Void</option>
        </select>

        <p className="text-sm text-muted-foreground">
          {totalCount} invoice{totalCount !== 1 ? 's' : ''} total
        </p>
      </div>

      {/* Invoice List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {selectedClientId
                ? 'No invoices found for this client.'
                : "Invoices are automatically generated when jobs are approved. They'll appear here once you start processing jobs."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Table */}
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="border-b bg-zinc-50">
                  <th className="text-left font-medium px-3 md:px-4 py-3">Invoice #</th>
                  <th className="text-left font-medium px-3 md:px-4 py-3">Client</th>
                  <th className="text-left font-medium px-3 md:px-4 py-3 hidden sm:table-cell">Date</th>
                  <th className="text-left font-medium px-3 md:px-4 py-3 hidden md:table-cell">Due</th>
                  <th className="text-right font-medium px-3 md:px-4 py-3">Amount</th>
                  <th className="text-right font-medium px-3 md:px-4 py-3 hidden sm:table-cell">Paid</th>
                  <th className="text-center font-medium px-3 md:px-4 py-3">Status</th>
                  {canDeleteInvoice && <th className="text-center font-medium px-3 md:px-4 py-3 w-20"></th>}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const style = STATUS_STYLES[inv.status] || STATUS_STYLES.draft
                  const isOverdue =
                    inv.status === 'sent' && new Date(inv.due_date) < new Date()
                  const displayStatus = isOverdue ? STATUS_STYLES.overdue : style

                  return (
                    <tr
                      key={inv.id}
                      className="border-b last:border-0 hover:bg-zinc-50/50 transition-colors cursor-pointer"
                      onClick={() => {
                        // Navigate to job detail (where invoice is displayed)
                        if (inv.job_id) {
                          window.location.href = `/jobs/${inv.job_id}`
                        }
                      }}
                    >
                      <td className="px-3 md:px-4 py-3 font-mono text-xs font-medium">
                        {inv.invoice_number}
                      </td>
                      <td className="px-3 md:px-4 py-3 max-w-[120px] truncate">
                        {inv.clients?.company_name || '—'}
                      </td>
                      <td className="px-3 md:px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="px-3 md:px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {formatDate(inv.due_date)}
                      </td>
                      <td className="px-3 md:px-4 py-3 text-right font-medium">
                        {formatCurrency(inv.total_amount)}
                      </td>
                      <td className="px-3 md:px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                        {inv.paid_amount > 0 ? formatCurrency(inv.paid_amount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={`text-[10px] border-0 ${displayStatus.className}`}>
                          {displayStatus.label}
                        </Badge>
                      </td>
                      {canDeleteInvoice && (
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {inv.status !== 'void' && inv.status !== 'paid' && (
                            confirmVoidId === inv.id ? (
                              <div className="flex items-center gap-1 justify-center">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 text-xs px-2"
                                  onClick={() => handleVoidInvoice(inv.id)}
                                  disabled={voidingId === inv.id}
                                >
                                  {voidingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Void'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs px-2"
                                  onClick={() => setConfirmVoidId(null)}
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setConfirmVoidId(inv.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
                {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
