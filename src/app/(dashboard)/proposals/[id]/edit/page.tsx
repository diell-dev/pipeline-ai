'use client'

/**
 * Edit Proposal Page
 *
 * Loads existing proposal + line items, hydrates the shared form, PATCHes on save.
 * Only allowed for draft / pending_admin_approval status.
 */
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  ProposalForm,
  type ProposalFormValues,
  emptyProposalForm,
} from '@/components/proposals/proposal-form'
import type { Proposal, ProposalLineItem } from '@/types/database'

export default function EditProposalPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { user } = useAuthStore()
  const canApprove = user?.role ? hasPermission(user.role, 'proposals:approve') : false

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [initial, setInitial] = useState<ProposalFormValues | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from('proposals')
        .select(`
          *,
          proposal_line_items ( id, service_catalog_id, service_name, description, quantity, unit, unit_price, total, sort_order )
        `)
        .eq('id', id)
        .single()

      if (error || !data) {
        setErrorMessage('Proposal not found')
        setLoading(false)
        return
      }

      const p = data as Proposal & { proposal_line_items?: ProposalLineItem[] }

      // Editing only allowed for draft + pending_admin_approval
      if (!['draft', 'pending_admin_approval'].includes(p.status)) {
        setErrorMessage(`Proposals in '${p.status}' status cannot be edited`)
        setLoading(false)
        return
      }

      const isCreator = p.created_by === user?.id
      if (!isCreator && !canApprove) {
        setErrorMessage('You do not have permission to edit this proposal')
        setLoading(false)
        return
      }

      const lineItems = (p.proposal_line_items || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((li) => ({
          service_catalog_id: li.service_catalog_id,
          service_name: li.service_name,
          description: li.description || '',
          quantity: Number(li.quantity) || 1,
          unit: li.unit || 'flat_rate',
          unit_price: Number(li.unit_price) || 0,
        }))

      setInitial({
        ...emptyProposalForm,
        client_id: p.client_id,
        site_id: p.site_id || '',
        measurements: p.measurements || '',
        material_list: p.material_list || [],
        estimated_hours: p.estimated_hours != null ? String(p.estimated_hours) : '',
        num_techs_needed: p.num_techs_needed,
        estimated_days: p.estimated_days,
        equipment_list: p.equipment_list || [],
        internal_notes: p.internal_notes || '',
        issue_description: p.issue_description,
        proposed_solution: p.proposed_solution,
        line_items: lineItems,
        discount_enabled: !!p.discount_enabled,
        discount_amount: Number(p.discount_amount) || 0,
        discount_reason: p.discount_reason || '',
        tax_rate: Number(p.tax_rate) || 8.875,
        valid_until: p.valid_until || '',
      })
      setLoading(false)
    }
    load()
  }, [id, user, canApprove])

  async function handleSave(values: ProposalFormValues) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measurements: values.measurements || null,
          material_list: values.material_list,
          estimated_hours: values.estimated_hours ? parseFloat(values.estimated_hours) : null,
          num_techs_needed: values.num_techs_needed,
          estimated_days: values.estimated_days,
          equipment_list: values.equipment_list,
          internal_notes: values.internal_notes || null,
          issue_description: values.issue_description,
          proposed_solution: values.proposed_solution,
          discount_enabled: values.discount_enabled,
          discount_amount: values.discount_amount,
          discount_reason: values.discount_reason || null,
          tax_rate: values.tax_rate,
          valid_until: values.valid_until || null,
          line_items: values.line_items
            .filter((li) => li.service_name.trim())
            .map((li) => ({
              service_catalog_id: li.service_catalog_id,
              service_name: li.service_name,
              description: li.description || null,
              quantity: li.quantity,
              unit: li.unit,
              unit_price: li.unit_price,
            })),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update proposal')
      }
      toast.success('Proposal updated')
      router.push(`/proposals/${id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (errorMessage || !initial) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <h3 className="text-lg font-semibold mb-1">Cannot edit proposal</h3>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button variant="outline" onClick={() => router.push(`/proposals/${id}`)}>
              Back to proposal
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push(`/proposals/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Proposal</h1>
          <p className="text-muted-foreground text-sm">
            Update fields. Totals are recalculated on save.
          </p>
        </div>
      </div>
      <ProposalForm
        initial={initial}
        submitLabel="Save Changes"
        submitting={submitting}
        onSubmit={handleSave}
        lockLocation
      />
    </div>
  )
}
