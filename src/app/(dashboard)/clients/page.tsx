'use client'

/**
 * Clients List Page
 *
 * - Owner/Office Manager: full CRUD
 * - Field Tech: read-only list
 * - Links to client detail page for sites management
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Building2, Plus, Loader2, Search, Phone, Mail, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import type { Client, ClientType, PaymentTerms, ServiceContractType } from '@/types/database'

const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  property_mgmt: 'Property Mgmt',
  landlord: 'Landlord',
  commercial: 'Commercial',
  residential: 'Residential',
  contractor: 'Contractor',
}

export default function ClientsPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const canCreate = user?.role ? hasPermission(user.role, 'clients:create') : false

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [saving, setSaving] = useState(false)

  // New client form state
  const [formData, setFormData] = useState({
    company_name: '',
    client_type: 'residential' as ClientType,
    primary_contact_name: '',
    primary_contact_phone: '',
    primary_contact_email: '',
    billing_address: '',
    payment_terms: 'net_30' as PaymentTerms,
    service_contract_type: 'one_time' as ServiceContractType,
    notes: '',
  })

  useEffect(() => {
    if (!organization) return

    async function loadClients() {
      setLoading(true)
      const supabase = createClient()

      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('organization_id', organization!.id)
        .is('deleted_at', null)
        .order('company_name')

      if (error) {
        console.error('Failed to load clients:', error.message)
        toast.error('Failed to load clients')
      } else {
        setClients(data || [])
      }
      setLoading(false)
    }

    loadClients()
  }, [organization])

  // Filter by search
  const filtered = clients.filter(
    (c) =>
      c.company_name.toLowerCase().includes(search.toLowerCase()) ||
      c.primary_contact_name.toLowerCase().includes(search.toLowerCase())
  )

  async function handleAddClient(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.company_name.trim() || !formData.primary_contact_name.trim()) {
      toast.error('Company name and contact name are required')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('clients')
        .insert({
          organization_id: organization!.id,
          ...formData,
        })
        .select()
        .single()

      if (error) throw error

      setClients([data, ...clients].sort((a, b) => a.company_name.localeCompare(b.company_name)))
      toast.success('Client added successfully')
      setShowAddDialog(false)
      resetForm()

      // Log activity
      await supabase.from('activity_log').insert({
        organization_id: organization!.id,
        user_id: user!.id,
        action: 'client_created',
        entity_type: 'client',
        entity_id: data.id,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to add client:', msg)
      toast.error('Failed to add client')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setFormData({
      company_name: '',
      client_type: 'residential',
      primary_contact_name: '',
      primary_contact_phone: '',
      primary_contact_email: '',
      billing_address: '',
      payment_terms: 'net_30',
      service_contract_type: 'one_time',
      notes: '',
    })
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground text-sm hidden sm:block">
            {canCreate
              ? 'Manage client accounts, contacts, and sites.'
              : 'View client information.'}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowAddDialog(true)} size="sm" className="shrink-0">
            <Plus className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Add Client</span>
            <span className="sm:hidden">Add</span>
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="pl-9 h-9"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">
              {search ? 'No matching clients' : 'No clients yet'}
            </h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {canCreate
                ? 'Add your first client to start managing their sites and jobs.'
                : 'No clients have been added yet.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Client list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((client) => (
            <Card
              key={client.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => router.push(`/clients/${client.id}`)}
            >
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{client.company_name}</span>
                    <Badge variant="outline" className="text-xs">
                      {CLIENT_TYPE_LABELS[client.client_type]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{client.primary_contact_name}</span>
                    {client.primary_contact_phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {client.primary_contact_phone}
                      </span>
                    )}
                    {client.primary_contact_email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {client.primary_contact_email}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Client Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
            <DialogDescription>
              Enter client details. You can add sites after creating the client.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddClient} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="company_name">Company Name *</Label>
                <Input
                  id="company_name"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  placeholder="e.g. ABC Property Management"
                  required
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="client_type">Client Type</Label>
                <select
                  id="client_type"
                  value={formData.client_type}
                  onChange={(e) => setFormData({ ...formData, client_type: e.target.value as ClientType })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="property_mgmt">Property Management</option>
                  <option value="landlord">Landlord</option>
                  <option value="contractor">Contractor</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment_terms">Payment Terms</Label>
                <select
                  id="payment_terms"
                  value={formData.payment_terms}
                  onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value as PaymentTerms })}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="on_receipt">On Receipt</option>
                  <option value="net_15">Net 15</option>
                  <option value="net_30">Net 30</option>
                  <option value="net_60">Net 60</option>
                </select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="primary_contact_name">Primary Contact Name *</Label>
                <Input
                  id="primary_contact_name"
                  value={formData.primary_contact_name}
                  onChange={(e) => setFormData({ ...formData, primary_contact_name: e.target.value })}
                  placeholder="John Smith"
                  required
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="primary_contact_phone">Phone</Label>
                <Input
                  id="primary_contact_phone"
                  type="tel"
                  value={formData.primary_contact_phone}
                  onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="primary_contact_email">Email</Label>
                <Input
                  id="primary_contact_email"
                  type="email"
                  value={formData.primary_contact_email}
                  onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                  placeholder="john@example.com"
                  className="h-9"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="billing_address">Billing Address</Label>
                <Input
                  id="billing_address"
                  value={formData.billing_address}
                  onChange={(e) => setFormData({ ...formData, billing_address: e.target.value })}
                  placeholder="123 Main St, New York, NY 10001"
                  className="h-9"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Any special instructions, preferences, or notes..."
                  className="min-h-[60px]"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Add Client'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
