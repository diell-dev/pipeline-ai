'use client'

/**
 * Proposals / Estimates List Page
 *
 * - Field Tech: own drafts + submissions
 * - Office Manager / Owner: full org view
 *
 * Filters: status, client, date range. Click row → /proposals/[id]
 */
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  FileSignature,
  Plus,
  Loader2,
  Calendar,
  Eye,
  Building2,
  ChevronDown,
} from 'lucide-react'
import type { Proposal, ProposalStatus } from '@/types/database'

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-zinc-100 text-zinc-700' },
  pending_admin_approval: { label: 'Pending Approval', className: 'bg-amber-100 text-amber-700' },
  admin_approved: { label: 'Approved', className: 'bg-blue-100 text-blue-700' },
  sent_to_client: { label: 'Sent to Client', className: 'bg-teal-100 text-teal-700' },
  client_approved: { label: 'Client Signed', className: 'bg-green-100 text-green-700' },
  client_rejected: { label: 'Client Rejected', className: 'bg-red-100 text-red-700' },
  converted_to_job: { label: 'Converted', className: 'bg-emerald-100 text-emerald-700' },
  expired: { label: 'Expired', className: 'bg-zinc-100 text-zinc-500' },
  cancelled: { label: 'Cancelled', className: 'bg-zinc-100 text-zinc-500' },
}

interface ProposalWithRelations extends Proposal {
  clients?: { company_name: string } | null
  sites?: { name: string; address: string } | null
  creator?: { full_name: string } | null
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function ProposalsPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const canCreate = user?.role ? hasPermission(user.role, 'proposals:create') : false
  const canViewAll = user?.role ? hasPermission(user.role, 'proposals:view_all') : false

  const [proposals, setProposals] = useState<ProposalWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | ProposalStatus>('all')
  const [clientFilter, setClientFilter] = useState<string>('')
  const [clients, setClients] = useState<{ id: string; company_name: string }[]>([])
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Load clients for dropdown
  useEffect(() => {
    if (!organization) return
    const supabase = createClient()
    supabase
      .from('clients')
      .select('id, company_name')
      .eq('organization_id', organization.id)
      .is('deleted_at', null)
      .order('company_name')
      .then(({ data }) => setClients(data || []))
  }, [organization])

  // Load proposals
  useEffect(() => {
    if (!organization || !user) return
    async function loadProposals() {
      setLoading(true)
      const supabase = createClient()
      let query = supabase
        .from('proposals')
        .select(`
          *,
          clients:client_id ( company_name ),
          sites:site_id ( name, address ),
          creator:created_by ( full_name )
        `)
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (!canViewAll) {
        query = query.eq('created_by', user!.id)
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }
      if (clientFilter) {
        query = query.eq('client_id', clientFilter)
      }
      if (fromDate) query = query.gte('created_at', fromDate)
      if (toDate) query = query.lte('created_at', toDate + 'T23:59:59.999Z')

      const { data, error } = await query.limit(100)
      if (error) {
        console.error('Failed to load proposals:', error.message)
      } else {
        setProposals((data as ProposalWithRelations[]) || [])
      }
      setLoading(false)
    }
    loadProposals()
  }, [organization, user, canViewAll, statusFilter, clientFilter, fromDate, toDate])

  const selectedClientName = useMemo(
    () => clients.find((c) => c.id === clientFilter)?.company_name,
    [clients, clientFilter]
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {canViewAll ? 'Proposals & Estimates' : 'My Proposals'}
          </h1>
          <p className="text-muted-foreground text-sm">
            First-visit estimates that turn into jobs once signed.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push('/proposals/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Proposal
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="min-w-[200px] justify-between"
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
              <div className="max-h-[260px] overflow-y-auto p-1">
                <button
                  className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                    !clientFilter ? 'font-semibold bg-accent' : ''
                  }`}
                  onClick={() => {
                    setClientFilter('')
                    setClientDropdownOpen(false)
                  }}
                >
                  All Clients
                </button>
                {clients.map((c) => (
                  <button
                    key={c.id}
                    className={`flex w-full items-center rounded-sm px-3 py-2 text-sm hover:bg-accent ${
                      clientFilter === c.id ? 'font-semibold bg-accent' : ''
                    }`}
                    onClick={() => {
                      setClientFilter(c.id)
                      setClientDropdownOpen(false)
                    }}
                  >
                    {c.company_name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground text-xs">From</span>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-8 w-[140px]"
          />
          <span className="text-muted-foreground text-xs">To</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-8 w-[140px]"
          />
          {(fromDate || toDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: 'all', label: 'All' },
          { value: 'draft', label: 'Draft' },
          { value: 'pending_admin_approval', label: 'Pending Approval' },
          { value: 'admin_approved', label: 'Approved' },
          { value: 'sent_to_client', label: 'Sent' },
          { value: 'client_approved', label: 'Signed' },
          { value: 'client_rejected', label: 'Rejected' },
          { value: 'converted_to_job', label: 'Converted' },
        ].map((tab) => (
          <Button
            key={tab.value}
            variant={statusFilter === tab.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(tab.value as typeof statusFilter)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && proposals.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileSignature className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">
              {statusFilter !== 'all' ? 'No proposals with this status' : 'No proposals yet'}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {canCreate
                ? 'Create a first-visit estimate that the client can review and sign online.'
                : 'Proposals will appear here once created.'}
            </p>
            {canCreate && (
              <Button className="mt-4" onClick={() => router.push('/proposals/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New Proposal
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && proposals.length > 0 && (
        <div className="overflow-hidden border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Number</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Client</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Total</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Created</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Valid Until</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => {
                const statusConf = STATUS_CONFIG[p.status]
                return (
                  <tr
                    key={p.id}
                    className="border-b hover:bg-zinc-50 cursor-pointer"
                    onClick={() => router.push(`/proposals/${p.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{p.proposal_number}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{p.clients?.company_name || 'Unknown'}</span>
                      {p.sites?.address && (
                        <p className="text-xs text-muted-foreground">{p.sites.address}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatCurrency(Number(p.total_amount) || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={statusConf.className} variant="outline">
                        {statusConf.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3 inline mr-1" />
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.valid_until ? new Date(p.valid_until).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-2 py-3">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
