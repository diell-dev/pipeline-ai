'use client'

/**
 * New Proposal Page
 *
 * Wizard-style form (see ProposalForm). On submit, POST /api/proposals → draft,
 * then redirect to the detail page.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { ProposalForm, type ProposalFormValues } from '@/components/proposals/proposal-form'

export default function NewProposalPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const canCreate = user?.role ? hasPermission(user.role, 'proposals:create') : false
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate(values: ProposalFormValues) {
    if (!canCreate) {
      toast.error('You do not have permission to create proposals')
      return
    }
    if (!values.client_id) {
      toast.error('Please select a client')
      return
    }
    if (!values.issue_description.trim() || !values.proposed_solution.trim()) {
      toast.error('Issue and proposed solution are required')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: values.client_id,
          site_id: values.site_id || null,
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
        throw new Error(data.error || 'Failed to create proposal')
      }
      toast.success(`Proposal ${data.proposal.proposal_number} created`)
      router.push(`/proposals/${data.proposal.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!canCreate) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <h3 className="text-lg font-semibold mb-1">Access Denied</h3>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have permission to create proposals.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Proposal</h1>
          <p className="text-muted-foreground text-sm">
            Capture a first-visit estimate. Saves as a draft until submitted for approval.
          </p>
        </div>
      </div>
      <ProposalForm
        submitLabel="Save as Draft"
        submitting={submitting}
        onSubmit={handleCreate}
      />
    </div>
  )
}
