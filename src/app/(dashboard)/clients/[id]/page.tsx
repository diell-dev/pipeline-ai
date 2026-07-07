'use client'

/**
 * Client Detail Page
 *
 * Shows client info + list of sites + stats (jobs, invoices, reports, unpaid balance).
 * Owners/managers can add/edit sites.
 * Field techs see read-only view.
 */
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Plus,
  Loader2,
  MapPin,
  Phone,
  Mail,
  Building2,
  Home,
  ClipboardList,
  FileText,
  DollarSign,
  AlertCircle,
  UserPlus,
} from 'lucide-react'
import type { Client, Site, SiteType, PipeMaterial, DrainType, InvoiceStatus } from '@/types/database'
import { useSwipeBack } from '@/hooks/use-swipe-back'

const SITE_TYPE_LABELS: Record<SiteType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  mixed_use: 'Mixed Use',
}

interface ClientStats {
  jobsCompleted: number
  totalJobs: number
  totalInvoices: number
  invoicesPaid: number
  invoicesUnpaid: number
  totalReports: number
  totalInvoiced: number
  totalPaid: number
  unpaidBalance: number
}

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuthStore()
  const clientId = params.id as string

  // M2.5 — iOS swipe-back. Attached to the page wrapper below.
  const swipeBackRef = useSwipeBack<HTMLDivElement>()

  const canEditClient = user?.role ? hasPermission(user.role, 'clients:edit') : false
  const canCreateSite = user?.role ? hasPermission(user.role, 'sites:create') : false
  const canInvitePortal = user?.role ? hasPermission(user.role, 'clients:invite_portal') : false

  const [client, setClient] = useState<Client | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [stats, setStats] = useState<ClientStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddSite, setShowAddSite] = useState(false)
  const [savingSite, setSavingSite] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '' })

  // New site form
  const [siteForm, setSiteForm] = useState({
    name: '',
    address: '',
    borough: '',
    site_type: 'residential' as SiteType,
    unit_count: '',
    access_instructions: '',
    pipe_material: 'unknown' as PipeMaterial,
    drain_types: [] as DrainType[],
    known_issues: '',
    equipment_notes: '',
  })

  async function handleInvitePortal(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/invite-portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to invite')
      toast.success(data.reactivated ? 'Portal access re-enabled' : `Invite sent to ${inviteForm.email}`)
      setShowInvite(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to invite')
    } finally {
      setInviting(false)
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()

      const [clientRes, sitesRes, jobsRes, invoicesRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase
          .from('sites')
          .select('*')
          .eq('client_id', clientId)
          .is('deleted_at', null)
          .order('name'),
        supabase
          .from('jobs')
          .select('id, status, ai_report_content')
          .eq('client_id', clientId)
          .is('deleted_at', null),
        supabase
          // TODO: drop legacy decimal columns (total_amount, paid_amount) once
          // all readers migrated. We now read cents columns; balance_due_cents
          // is a generated column maintained by the DB.
          .from('invoices')
          .select('id, status, total_cents, amount_paid_cents, balance_due_cents')
          .eq('client_id', clientId),
      ])

      if (clientRes.error) {
        toast.error('Client not found')
        router.push('/clients')
        return
      }

      setClient(clientRes.data)
      setSites(sitesRes.data || [])

      // Calculate stats
      const jobs = jobsRes.data || []
      const invoices = invoicesRes.data || []

      const completedStatuses = ['completed', 'sent', 'approved']
      const jobsCompleted = jobs.filter((j) => completedStatuses.includes(j.status)).length
      const totalReports = jobs.filter((j) => j.ai_report_content != null).length

      const invoicesPaid = invoices.filter((i) => i.status === 'paid').length
      const invoicesUnpaid = invoices.filter((i) =>
        ['sent', 'draft', 'partially_paid', 'overdue'].includes(i.status)
      ).length
      // Sum cents columns then convert at display boundary. balance_due_cents
      // is the authoritative outstanding figure (generated by the DB), so we
      // sum that directly rather than recomputing total - paid.
      const totalInvoicedCents = invoices.reduce((sum, i) => sum + (Number(i.total_cents) || 0), 0)
      const totalPaidCents = invoices.reduce((sum, i) => sum + (Number(i.amount_paid_cents) || 0), 0)
      const unpaidBalanceCents = invoices.reduce((sum, i) => sum + Math.max(0, Number(i.balance_due_cents) || 0), 0)

      setStats({
        jobsCompleted,
        totalJobs: jobs.length,
        totalInvoices: invoices.length,
        invoicesPaid,
        invoicesUnpaid,
        totalReports,
        totalInvoiced: totalInvoicedCents / 100,
        totalPaid: totalPaidCents / 100,
        unpaidBalance: unpaidBalanceCents / 100,
      })

      setLoading(false)
    }

    if (clientId) load()
  }, [clientId, router])

  async function handleAddSite(e: React.FormEvent) {
    e.preventDefault()
    if (!siteForm.name.trim() || !siteForm.address.trim()) {
      toast.error('Site name and address are required')
      return
    }

    setSavingSite(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('sites')
        .insert({
          client_id: clientId,
          organization_id: client!.organization_id,
          name: siteForm.name,
          address: siteForm.address,
          borough: siteForm.borough || null,
          site_type: siteForm.site_type,
          unit_count: siteForm.unit_count ? parseInt(siteForm.unit_count) : null,
          access_instructions: siteForm.access_instructions || null,
          pipe_material: siteForm.pipe_material,
          drain_types: siteForm.drain_types,
          known_issues: siteForm.known_issues || null,
          equipment_notes: siteForm.equipment_notes || null,
          reference_photos: [],
        })
        .select()
        .single()

      if (error) throw error

      setSites([...sites, data].sort((a, b) => a.name.localeCompare(b.name)))
      toast.success('Site added successfully')
      setShowAddSite(false)
      resetSiteForm()

      await supabase.from('activity_log').insert({
        organization_id: client!.organization_id,
        user_id: user!.id,
        action: 'site_created',
        entity_type: 'site',
        entity_id: data.id,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to add site:', msg)
      toast.error('Failed to add site')
    } finally {
      setSavingSite(false)
    }
  }

  function resetSiteForm() {
    setSiteForm({
      name: '',
      address: '',
      borough: '',
      site_type: 'residential',
      unit_count: '',
      access_instructions: '',
      pipe_material: 'unknown',
      drain_types: [],
      known_issues: '',
      equipment_notes: '',
    })
  }

  function toggleDrainType(dt: DrainType) {
    setSiteForm((prev) => ({
      ...prev,
      drain_types: prev.drain_types.includes(dt)
        ? prev.drain_types.filter((d) => d !== dt)
        : [...prev.drain_types, dt],
    }))
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (!client) return null

  return (
    <div
      ref={swipeBackRef}
      className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 will-change-transform"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => router.push('/clients')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-words">{client.company_name}</h1>
          <p className="text-muted-foreground text-sm">
            Client details and site management
          </p>
        </div>
        {canInvitePortal && (
          <Button
            variant="outline"
            className="ml-auto h-10 shrink-0"
            onClick={() => {
              setInviteForm({
                email: client.primary_contact_email || '',
                full_name: client.primary_contact_name || '',
              })
              setShowInvite(true)
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" /> Invite to portal
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link href={`/jobs?client=${clientId}`}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <ClipboardList className="h-4 w-4" />
                  <span className="text-xs font-medium">Jobs</span>
                </div>
                <p className="text-2xl font-bold">{stats.jobsCompleted}</p>
                <p className="text-xs text-muted-foreground">
                  of {stats.totalJobs} completed
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/jobs?client=${clientId}&has_report=true`}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <FileText className="h-4 w-4" />
                  <span className="text-xs font-medium">Reports</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalReports}</p>
                <p className="text-xs text-muted-foreground">AI-generated</p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/invoices?client=${clientId}`}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-xs font-medium">Invoices</span>
                </div>
                <p className="text-2xl font-bold">{stats.totalInvoices}</p>
                <div className="flex gap-2 mt-0.5">
                  {stats.invoicesPaid > 0 && (
                    <Badge className="text-[10px] bg-green-100 text-green-700 border-0">
                      {stats.invoicesPaid} paid
                    </Badge>
                  )}
                  {stats.invoicesUnpaid > 0 && (
                    <Badge className="text-[10px] bg-amber-100 text-amber-700 border-0">
                      {stats.invoicesUnpaid} unpaid
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/invoices?client=${clientId}&status=unpaid`}>
            <Card className={`cursor-pointer hover:shadow-md transition-shadow ${stats.unpaidBalance > 0 ? 'border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10' : ''}`}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  {stats.unpaidBalance > 0 ? (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  ) : (
                    <DollarSign className="h-4 w-4" />
                  )}
                  <span className="text-xs font-medium">Unpaid Balance</span>
                </div>
                <p className={`text-2xl font-bold ${stats.unpaidBalance > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  {formatCurrency(stats.unpaidBalance)}
                </p>
                <p className="text-xs text-muted-foreground">
                  of {formatCurrency(stats.totalInvoiced)} total
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {/* Client Info */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Client Information
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Contact</p>
              <p className="font-medium break-words">{client.primary_contact_name}</p>
            </div>
            {client.primary_contact_phone && (
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium flex items-center gap-1 break-all">
                  <Phone className="h-3 w-3 shrink-0" /> {client.primary_contact_phone}
                </p>
              </div>
            )}
            {client.primary_contact_email && (
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium flex items-center gap-1 break-all">
                  <Mail className="h-3 w-3 shrink-0" /> {client.primary_contact_email}
                </p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground">Payment Terms</p>
              <p className="font-medium">{client.payment_terms.replace('_', ' ')}</p>
            </div>
            {client.billing_address && (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Billing Address</p>
                <p className="font-medium break-words">{client.billing_address}</p>
              </div>
            )}
            {client.notes && (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Notes</p>
                <p className="text-sm whitespace-pre-wrap break-words">{client.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sites */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-semibold">Sites ({sites.length})</h2>
        {canCreateSite && (
          <Button onClick={() => setShowAddSite(true)} className="h-10 w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Add Site
          </Button>
        )}
      </div>

      {sites.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Home className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold mb-1">No sites yet</h3>
            <p className="text-sm text-muted-foreground text-center">
              {canCreateSite
                ? 'Add a site to start submitting jobs for this client.'
                : 'No sites have been added for this client yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sites.map((site) => (
            <Card key={site.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{site.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {SITE_TYPE_LABELS[site.site_type]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">{site.address}</p>
                    {site.borough && (
                      <p className="text-xs text-muted-foreground ml-6">{site.borough}</p>
                    )}
                    {site.access_instructions && (
                      <p className="text-xs text-muted-foreground ml-6">
                        <span className="font-medium">Access:</span> {site.access_instructions}
                      </p>
                    )}
                    {site.drain_types && site.drain_types.length > 0 && (
                      <div className="flex gap-1 ml-6 flex-wrap">
                        {site.drain_types.map((dt) => (
                          <Badge key={dt} variant="outline" className="text-[10px]">
                            {dt.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Site Dialog */}
      <Dialog open={showAddSite} onOpenChange={setShowAddSite}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Site</DialogTitle>
            <DialogDescription className="break-words">
              Add a service location for {client.company_name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddSite} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="site_name">Site Name *</Label>
                <Input
                  id="site_name"
                  value={siteForm.name}
                  onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                  placeholder="e.g. Building A - 123 Main St"
                  required
                  className="h-10"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="site_address">Address *</Label>
                <Input
                  id="site_address"
                  value={siteForm.address}
                  onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}
                  placeholder="123 Main St, New York, NY 10001"
                  required
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="borough">Borough</Label>
                <Input
                  id="borough"
                  value={siteForm.borough}
                  onChange={(e) => setSiteForm({ ...siteForm, borough: e.target.value })}
                  placeholder="Manhattan"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="site_type">Site Type</Label>
                <select
                  id="site_type"
                  value={siteForm.site_type}
                  onChange={(e) => setSiteForm({ ...siteForm, site_type: e.target.value as SiteType })}
                  className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="industrial">Industrial</option>
                  <option value="mixed_use">Mixed Use</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="unit_count">Unit Count</Label>
                <Input
                  id="unit_count"
                  type="number"
                  value={siteForm.unit_count}
                  onChange={(e) => setSiteForm({ ...siteForm, unit_count: e.target.value })}
                  placeholder="e.g. 12"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pipe_material">Pipe Material</Label>
                <select
                  id="pipe_material"
                  value={siteForm.pipe_material}
                  onChange={(e) => setSiteForm({ ...siteForm, pipe_material: e.target.value as PipeMaterial })}
                  className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="unknown">Unknown</option>
                  <option value="cast_iron">Cast Iron</option>
                  <option value="pvc">PVC</option>
                  <option value="clay">Clay</option>
                  <option value="copper">Copper</option>
                </select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Drain Types</Label>
                <div className="flex flex-wrap gap-2">
                  {(['floor_drain', 'sewer_line', 'grease_trap', 'storm_drain', 'roof_drain'] as DrainType[]).map((dt) => (
                    <button
                      key={dt}
                      type="button"
                      onClick={() => toggleDrainType(dt)}
                      className={`px-3 py-2 min-h-[44px] rounded-md text-xs border transition-colors ${
                        siteForm.drain_types.includes(dt)
                          ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-500/40 dark:text-blue-300'
                          : 'bg-muted border-border text-muted-foreground hover:bg-muted/80 dark:hover:bg-muted'
                      }`}
                    >
                      {dt.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="access_instructions">Access Instructions</Label>
                <Textarea
                  id="access_instructions"
                  value={siteForm.access_instructions}
                  onChange={(e) => setSiteForm({ ...siteForm, access_instructions: e.target.value })}
                  placeholder="e.g. Enter through side gate, key code 1234"
                  className="min-h-[60px]"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="known_issues">Known Issues</Label>
                <Textarea
                  id="known_issues"
                  value={siteForm.known_issues}
                  onChange={(e) => setSiteForm({ ...siteForm, known_issues: e.target.value })}
                  placeholder="e.g. Basement floods during heavy rain"
                  className="min-h-[60px]"
                />
              </div>
            </div>

            <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddSite(false)}
                className="h-10 w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingSite} className="h-10 w-full sm:w-auto">
                {savingSite ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Add Site'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Invite to client portal */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to client portal</DialogTitle>
            <DialogDescription>
              Give {client.company_name} a secure login to see their jobs, reports, invoices, and upcoming visits. You can invite more than one contact.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvitePortal} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite_name">Contact name</Label>
              <Input
                id="invite_name"
                value={inviteForm.full_name}
                onChange={(e) => setInviteForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite_email">Email</Label>
              <Input
                id="invite_email"
                type="email"
                required
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowInvite(false)} disabled={inviting}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting || !inviteForm.email}>
                {inviting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Inviting…</>
                ) : (
                  'Send invite'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
