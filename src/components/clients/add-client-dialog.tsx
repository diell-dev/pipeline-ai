'use client'

/**
 * AddClientDialog
 *
 * Lightweight controlled dialog for inline client creation from any
 * picker (e.g. ClientCombobox). Mirrors the essentials of the full
 * Add Client form on /clients but keeps it tight — only the fields
 * required to create a usable client. Optional fields like billing
 * address, service contract type, and notes can be filled in later
 * from the dedicated Clients page.
 */
import { useEffect, useState } from 'react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Client, ClientType, PaymentTerms } from '@/types/database'

interface AddClientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefill the company_name field (e.g. from typed search text). */
  defaultName?: string
  /** Called with the freshly inserted client row on success. */
  onCreated: (client: Client) => void
}

export function AddClientDialog({
  open,
  onOpenChange,
  defaultName = '',
  onCreated,
}: AddClientDialogProps) {
  const { user, organization } = useAuthStore()

  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    company_name: '',
    client_type: 'residential' as ClientType,
    primary_contact_name: '',
    primary_contact_phone: '',
    primary_contact_email: '',
    payment_terms: 'net_30' as PaymentTerms,
  })

  // Reset / sync form whenever the dialog (re)opens or defaultName changes.
  useEffect(() => {
    if (open) {
      setFormData({
        company_name: defaultName,
        client_type: 'residential',
        primary_contact_name: '',
        primary_contact_phone: '',
        primary_contact_email: '',
        payment_terms: 'net_30',
      })
    }
  }, [open, defaultName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!organization || !user) {
      toast.error('You must be signed in to add a client')
      return
    }
    if (!formData.company_name.trim() || !formData.primary_contact_name.trim()) {
      toast.error('Company name and contact name are required')
      return
    }

    setSaving(true)
    try {
      const supabase = createSupabaseClient()
      const { data, error } = await supabase
        .from('clients')
        .insert({
          organization_id: organization.id,
          company_name: formData.company_name.trim(),
          client_type: formData.client_type,
          primary_contact_name: formData.primary_contact_name.trim(),
          primary_contact_phone: formData.primary_contact_phone.trim() || null,
          primary_contact_email: formData.primary_contact_email.trim() || null,
          payment_terms: formData.payment_terms,
        })
        .select()
        .single()

      if (error) throw error

      // Best-effort activity log (don't block on failure)
      await supabase.from('activity_log').insert({
        organization_id: organization.id,
        user_id: user.id,
        action: 'client_created',
        entity_type: 'client',
        entity_id: data.id,
      })

      toast.success('Client added')
      onCreated(data as Client)
      onOpenChange(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add client'
      console.error('Failed to add client:', msg)
      toast.error('Failed to add client')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
          <DialogDescription>
            Quick-add a client. You can fill in billing address, sites, and notes later from the Clients page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ac_company_name">Company Name *</Label>
              <Input
                id="ac_company_name"
                value={formData.company_name}
                onChange={(e) =>
                  setFormData({ ...formData, company_name: e.target.value })
                }
                placeholder="e.g. ABC Property Management"
                required
                autoFocus
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ac_client_type">Client Type</Label>
              <select
                id="ac_client_type"
                value={formData.client_type}
                onChange={(e) =>
                  setFormData({ ...formData, client_type: e.target.value as ClientType })
                }
                className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="property_mgmt">Property Management</option>
                <option value="landlord">Landlord</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ac_payment_terms">Payment Terms</Label>
              <select
                id="ac_payment_terms"
                value={formData.payment_terms}
                onChange={(e) =>
                  setFormData({ ...formData, payment_terms: e.target.value as PaymentTerms })
                }
                className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="on_receipt">On Receipt</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_60">Net 60</option>
              </select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ac_primary_contact_name">Primary Contact Name *</Label>
              <Input
                id="ac_primary_contact_name"
                value={formData.primary_contact_name}
                onChange={(e) =>
                  setFormData({ ...formData, primary_contact_name: e.target.value })
                }
                placeholder="John Smith"
                required
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ac_primary_contact_phone">Phone</Label>
              <Input
                id="ac_primary_contact_phone"
                type="tel"
                value={formData.primary_contact_phone}
                onChange={(e) =>
                  setFormData({ ...formData, primary_contact_phone: e.target.value })
                }
                placeholder="(555) 123-4567"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ac_primary_contact_email">Email</Label>
              <Input
                id="ac_primary_contact_email"
                type="email"
                value={formData.primary_contact_email}
                onChange={(e) =>
                  setFormData({ ...formData, primary_contact_email: e.target.value })
                }
                placeholder="john@example.com"
                className="h-10"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
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
  )
}
