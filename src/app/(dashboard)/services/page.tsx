'use client'

/**
 * Service Catalog Page
 *
 * - Owner/Super Admin: full CRUD (add, edit, toggle active)
 * - Office Manager: read-only
 * - Field Tech: read-only
 */
import { useState, useEffect } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Wrench, Plus, Loader2, Search, DollarSign, Tag } from 'lucide-react'
import { toast } from 'sonner'
import type { ServiceCatalogItem, ServiceUnit } from '@/types/database'

const UNIT_LABELS: Record<ServiceUnit, string> = {
  flat_rate: 'Flat Rate',
  per_drain: 'Per Drain',
  per_line: 'Per Line',
  per_trap: 'Per Trap',
  hourly: 'Hourly',
}

export default function ServicesPage() {
  const { user, organization } = useAuthStore()
  const canManage = user?.role ? hasPermission(user.role, 'services:manage') : false

  const [services, setServices] = useState<ServiceCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [saving, setSaving] = useState(false)

  // New service form state
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    default_price: '',
    unit: 'flat_rate' as ServiceUnit,
  })

  useEffect(() => {
    if (!organization) return

    async function loadServices() {
      setLoading(true)
      const supabase = createClient()

      const { data, error } = await supabase
        .from('service_catalog')
        .select('*')
        .eq('organization_id', organization!.id)
        .order('name')

      if (error) {
        console.error('Failed to load services:', error.message)
        toast.error('Failed to load services')
      } else {
        setServices(data || [])
      }
      setLoading(false)
    }

    loadServices()
  }, [organization])

  // Filter by search
  const filtered = services.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleAddService(e: React.FormEvent) {
    e.preventDefault()
    if (!organization) return
    setSaving(true)

    const supabase = createClient()
    const { error } = await supabase.from('service_catalog').insert({
      organization_id: organization.id,
      code: formData.code.toUpperCase(),
      name: formData.name,
      description: formData.description || null,
      default_price: parseFloat(formData.default_price) || 0,
      unit: formData.unit,
    })

    if (error) {
      console.error('Failed to add service:', error.message)
      toast.error('Failed to add service')
    } else {
      toast.success('Service added')
      setShowAddDialog(false)
      setFormData({ code: '', name: '', description: '', default_price: '', unit: 'flat_rate' })
      // Reload services
      const { data } = await supabase
        .from('service_catalog')
        .select('*')
        .eq('organization_id', organization.id)
        .order('name')
      setServices(data || [])
    }
    setSaving(false)
  }

  async function toggleActive(service: ServiceCatalogItem) {
    const supabase = createClient()
    const { error } = await supabase
      .from('service_catalog')
      .update({ is_active: !service.is_active })
      .eq('id', service.id)

    if (error) {
      toast.error('Failed to update service')
    } else {
      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, is_active: !s.is_active } : s))
      )
      toast.success(service.is_active ? 'Service deactivated' : 'Service activated')
    }
  }

  const activeServices = filtered.filter((s) => s.is_active)
  const inactiveServices = filtered.filter((s) => !s.is_active)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground">
            Define your services, pricing, and units for invoicing.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Service
          </Button>
        )}
      </div>

      {/* Search */}
      {services.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Wrench className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No services defined</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Set up your service catalog with standard pricing. These will be used when creating jobs and generating invoices.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>{activeServices.length} active service{activeServices.length !== 1 ? 's' : ''}</span>
            {inactiveServices.length > 0 && (
              <span>{inactiveServices.length} inactive</span>
            )}
          </div>

          {/* Services grid */}
          <div className="grid gap-3">
            {filtered.map((service) => (
              <Card
                key={service.id}
                className={`transition-opacity ${!service.is_active ? 'opacity-50' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{service.name}</h3>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {service.code}
                        </Badge>
                        {!service.is_active && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      {service.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {service.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-4 shrink-0">
                      <div className="text-right">
                        <div className="flex items-center gap-1 font-semibold">
                          <DollarSign className="h-3.5 w-3.5" />
                          {Number(service.default_price).toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {UNIT_LABELS[service.unit]}
                        </div>
                      </div>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(service)}
                          className="text-xs"
                        >
                          {service.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add Service Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Service</DialogTitle>
            <DialogDescription>
              Add a new service to your catalog with default pricing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddService} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Service Code *</Label>
                <Input
                  id="code"
                  placeholder="e.g. MAIN-JET"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Service Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g. Main Sewer Jetting"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the service..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Default Price ($) *</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={formData.default_price}
                  onChange={(e) => setFormData({ ...formData, default_price: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Pricing Unit *</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => value && setFormData({ ...formData, unit: value as ServiceUnit })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat_rate">Flat Rate</SelectItem>
                    <SelectItem value="per_drain">Per Drain</SelectItem>
                    <SelectItem value="per_line">Per Line</SelectItem>
                    <SelectItem value="per_trap">Per Trap</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Service
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
