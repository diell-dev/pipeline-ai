'use client'

/**
 * Client Detail Page
 *
 * Shows client info + list of sites. Owners/managers can add/edit sites.
 * Field techs see read-only view.
 */
import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import type { Client, Site, SiteType, PipeMaterial, DrainType } from '@/types/database'

const SITE_TYPE_LABELS: Record<SiteType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  mixed_use: 'Mixed Use',
}

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuthStore()
  const clientId = params.id as string

  const canEditClient = user?.role ? hasPermission(user.role, 'clients:edit') : false
  const canCreateSite = user?.role ? hasPermission(user.role, 'sites:create') : false

  const [client, setClient] = useState<Client | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddSite, setShowAddSite] = useState(false)
  const [savingSite, setSavingSite] = useState(false)

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

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()

      const [clientRes, sitesRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase
          .from('sites')
          .select('*')
          .eq('client_id', clientId)
          .is('deleted_at', null)
          .order('name'),
      ])

      if (clientRes.error) {
        toast.error('Client not found')
        router.push('/clients')
        return
      }

      setClient(clientRes.data)
      setSites(sitesRes.data || [])
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

      // Log
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!client) return null

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/clients')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{client.company_name}</h1>
          <p className="text-muted-foreground text-sm">
            Client details and site management
          </p>
        </div>
      </div>

      {/* Client Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Client Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Contact</p>
              <p className="font-medium">{client.primary_contact_name}</p>
            </div>
            {client.primary_contact_phone && (
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {client.primary_contact_phone}
                </p>
              </div>
            )}
            {client.primary_contact_email && (
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium flex items-center gap-1">
                  <Mail className="h-3 w-3" /> {client.primary_contact_email}
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
                <p className="font-medium">{client.billing_address}</p>
              </div>
            )}
            {client.notes && (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sites */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sites ({sites.length})</h2>
        {canCreateSite && (
          <Button size="sm" onClick={() => setShowAddSite(true)}>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Site</DialogTitle>
            <DialogDescription>
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
                  className="h-9"
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
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="borough">Borough</Label>
                <Input
                  id="borough"
                  value={siteForm.borough}
                  onChange={(e) => setSiteForm({ ...siteForm, borough: e.target.value })}
                  placeholder="Manhattan"
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="site_type">Site Type</Label>
                <select
                  id="site_type"
                  value={siteForm.site_type}
                  onChange={(e) => setSiteForm({ ...siteForm, site_type: e.target.value as SiteType })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pipe_material">Pipe Material</Label>
                <select
                  id="pipe_material"
                  value={siteForm.pipe_material}
                  onChange={(e) => setSiteForm({ ...siteForm, pipe_material: e.target.value as PipeMaterial })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                        siteForm.drain_types.includes(dt)
                          ? 'bg-blue-100 border-blue-300 text-blue-700'
                          : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddSite(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingSite}>
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
    </div>
  )
}
