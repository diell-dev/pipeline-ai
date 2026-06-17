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
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { MarkPaidDialog } from '@/components/invoices/mark-paid-dialog'
import { SkeletonList } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SwipeableRow, type SwipeAction } from '@/components/ui/swipeable-row'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import { toast } from 'sonner'
import {
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Trash2,
  CheckCircle2,
} from 'lucide-react'
import type { InvoiceStatus, Client } from '@/types/database'

// UX-SWEEP-#7: /finances should be the read-only analytics view —
// remove row actions (Mark Paid, trash) from finances/page.tsx and add a
// "View all in Invoices →" link there. This page (/invoices) remains the
// operational list with full row actions.

const MARK_PAID_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'overdue', 'partially_paid']

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
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  sent: { label: 'Sent', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  paid: { label: 'Paid', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  partially_paid: { label: 'Partial', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  void: { label: 'Void', className: 'bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400' },
}

const PAGE_SIZE = 15

export default function InvoicesPage() {
  const { organization, user } = useAuthStore()
  const searchParams = useSearchParams()
  const canDeleteInvoice = user?.role ? hasPermission(user.role, 'invoices:delete') : false
  const canMarkPaid = user?.role ? hasPermission(user.role, 'invoices:mark_paid') : false
  const isSuperAdmin = user?.role === 'super_admin'

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null)
  // M4.6 — swipe-action target for Mark Paid. MarkPaidDialog wraps a
  // trigger child; to open it from a swipe we keep a ref to the per-row
  // trigger button and synthesize a click on it.
  const markPaidTriggers = useRef<Record<string, HTMLButtonElement | null>>({})

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
      let q = supabase
        .from('clients')
        .select('*')
        .is('deleted_at', null)
        .order('company_name')
      if (!isSuperAdmin) q = q.eq('organization_id', organization!.id)
      const { data } = await q

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
  }, [organization, clientIdFromParam, isSuperAdmin])

  // Load invoices
  const loadInvoices = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from('invoices')
      .select('*, clients(company_name)', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (!isSuperAdmin) {
      query = query.eq('organization_id', organization.id)
    }

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
  }, [organization, page, selectedClientId, statusFilter, isSuperAdmin])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  // M4.5 — pull-to-refresh on the same loader. Touch-only.
  const { PullIndicator: InvoicesPullIndicator } = usePullToRefresh({
    onRefresh: loadInvoices,
  })

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

  // UX-SWEEP-#17: row subtitle — five identical-looking rows in a row are hard to
  // distinguish, so show created-relative-time per row. Lightweight, no extra join.
  function formatRelative(dateStr: string) {
    const then = new Date(dateStr).getTime()
    const now = Date.now()
    const diffMs = now - then
    const mins = Math.round(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    if (days < 30) return `${days}d ago`
    const months = Math.round(days / 30)
    if (months < 12) return `${months}mo ago`
    const yrs = Math.round(months / 12)
    return `${yrs}y ago`
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
    <div className="relative p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* M4.5 — pull-to-refresh; renders nothing on desktop */}
      <InvoicesPullIndicator />
      <PageHeader
        title="Invoices"
        subtitle="Track invoices, payment status, and outstanding balances."
      />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-72">
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
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 max-h-48 overflow-auto">
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c.id, c.company_name)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
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
        <SkeletonList rows={6} />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={selectedClientId ? 'No invoices for this client' : 'No invoices yet'}
          description={
            selectedClientId
              ? 'Try a different client or clear the filter.'
              : "Invoices are automatically generated when jobs are approved. They'll appear here once you start processing jobs."
          }
        />
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {invoices.map((inv, idx) => {
              const style = STATUS_STYLES[inv.status] || STATUS_STYLES.draft
              const isOverdue =
                inv.status === 'sent' && new Date(inv.due_date) < new Date()
              const displayStatus = isOverdue ? STATUS_STYLES.overdue : style
              const showActions =
                (canMarkPaid && MARK_PAID_STATUSES.includes(inv.status)) ||
                (canDeleteInvoice && inv.status !== 'void' && inv.status !== 'paid')

              // M4.6 — swipe-left to reveal Mark Paid + Delete. We only
              // populate the destructive Delete action when the user has
              // the perm AND the invoice isn't already settled — mirrors
              // the inline button visibility rules.
              const swipeActions: SwipeAction[] = []
              if (canMarkPaid && MARK_PAID_STATUSES.includes(inv.status)) {
                swipeActions.push({
                  label: 'Mark Paid',
                  color: 'bg-green-600 hover:bg-green-700',
                  onClick: () => {
                    // Defer to the existing MarkPaidDialog by clicking its
                    // hidden per-row trigger. Keeps validation + form
                    // behavior identical between swipe and tap.
                    markPaidTriggers.current[inv.id]?.click()
                  },
                })
              }
              if (canDeleteInvoice && inv.status !== 'void' && inv.status !== 'paid') {
                swipeActions.push({
                  label: 'Delete',
                  color: 'bg-red-600 hover:bg-red-700',
                  destructive: true,
                  onClick: () => setConfirmVoidId(inv.id),
                })
              }

              return (
                <SwipeableRow key={inv.id} rightActions={swipeActions} className="rounded-lg">
                <div
                  style={{ '--row-index': idx } as React.CSSProperties}
                  className="row-stagger-up rounded-lg border bg-card p-4 space-y-3"
                  onClick={() => {
                    if (inv.job_id) {
                      window.location.href = `/jobs/${inv.job_id}`
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-medium truncate">
                        {inv.invoice_number}
                      </p>
                      <p className="text-sm font-medium truncate mt-0.5">
                        {inv.clients?.company_name || '—'}
                      </p>
                      {/* UX-SWEEP-#17: created-time subtitle */}
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Created {formatRelative(inv.created_at)}
                      </p>
                    </div>
                    <Badge className={`text-[10px] border-0 shrink-0 ${displayStatus.className}`}>
                      {displayStatus.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total:</span>{' '}
                      <span className="font-medium">{formatCurrency(inv.total_amount)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Paid:</span>{' '}
                      <span>
                        {inv.paid_amount > 0 ? formatCurrency(inv.paid_amount) : '—'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Due:</span>{' '}
                      <span>{formatDate(inv.due_date)}</span>
                    </div>
                  </div>
                  {showActions && (
                    <div
                      className="flex gap-2 pt-2 border-t"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canMarkPaid && MARK_PAID_STATUSES.includes(inv.status) && (
                        <MarkPaidDialog
                          invoice={{
                            id: inv.id,
                            invoice_number: inv.invoice_number,
                            total_amount: Number(inv.total_amount) || 0,
                          }}
                          onSuccess={loadInvoices}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-10 text-green-700 hover:text-green-800 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-500/10"
                            // M4.6 — ref captured so the swipe-action handler
                            // can re-fire the same trigger.
                            ref={(el) => {
                              markPaidTriggers.current[inv.id] = el
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Mark Paid
                          </Button>
                        </MarkPaidDialog>
                      )}
                      {canDeleteInvoice && inv.status !== 'void' && inv.status !== 'paid' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-10 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/10"
                          onClick={() => setConfirmVoidId(inv.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Void
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                </SwipeableRow>
              )
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium px-4 py-3">Invoice #</th>
                  <th className="text-left font-medium px-4 py-3">Client</th>
                  <th className="text-left font-medium px-4 py-3">Date</th>
                  <th className="text-left font-medium px-4 py-3">Due</th>
                  <th className="text-right font-medium px-4 py-3">Amount</th>
                  <th className="text-right font-medium px-4 py-3">Paid</th>
                  <th className="text-center font-medium px-4 py-3">Status</th>
                  {(canDeleteInvoice || canMarkPaid) && (
                    <th className="text-center font-medium px-4 py-3 w-40">Actions</th>
                  )}
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
                      className="border-b last:border-0 hover:bg-muted even:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => {
                        // Navigate to job detail (where invoice is displayed)
                        if (inv.job_id) {
                          window.location.href = `/jobs/${inv.job_id}`
                        }
                      }}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium align-top">
                        <div>{inv.invoice_number}</div>
                        {/* UX-SWEEP-#17: created-time subtitle so otherwise-identical rows
                            are distinguishable at a glance */}
                        <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                          {formatRelative(inv.created_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {inv.clients?.company_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground align-top">
                        {formatDate(inv.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground align-top">
                        {formatDate(inv.due_date)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium align-top">
                        {formatCurrency(inv.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground align-top">
                        {inv.paid_amount > 0 ? formatCurrency(inv.paid_amount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        <Badge className={`text-[10px] border-0 ${displayStatus.className}`}>
                          {displayStatus.label}
                        </Badge>
                      </td>
                      {(canDeleteInvoice || canMarkPaid) && (
                        <td className="px-4 py-3 text-center align-top" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-center">
                            {canMarkPaid && MARK_PAID_STATUSES.includes(inv.status) && (
                              <MarkPaidDialog
                                invoice={{
                                  id: inv.id,
                                  invoice_number: inv.invoice_number,
                                  total_amount: Number(inv.total_amount) || 0,
                                }}
                                onSuccess={loadInvoices}
                              >
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs px-2 text-green-700 hover:text-green-800 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-500/10"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Mark Paid
                                </Button>
                              </MarkPaidDialog>
                            )}
                            {canDeleteInvoice && inv.status !== 'void' && inv.status !== 'paid' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/10"
                                onClick={() => setConfirmVoidId(inv.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* UX-SWEEP-#1: confirm dialog before delete (was an inline two-button swap that
              was easy to misclick). One shared modal for mobile + desktop rows. */}
          <Dialog open={!!confirmVoidId} onOpenChange={(open) => !open && !voidingId && setConfirmVoidId(null)}>
            <DialogContent className="sm:max-w-md">
              {(() => {
                const target = invoices.find((i) => i.id === confirmVoidId)
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>
                        Delete invoice {target?.invoice_number || ''}?
                      </DialogTitle>
                      <DialogDescription>
                        This cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setConfirmVoidId(null)}
                        disabled={!!voidingId}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => confirmVoidId && handleVoidInvoice(confirmVoidId)}
                        disabled={!!voidingId}
                      >
                        {voidingId ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Deleting…
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </>
                        )}
                      </Button>
                    </DialogFooter>
                  </>
                )
              })()}
            </DialogContent>
          </Dialog>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
