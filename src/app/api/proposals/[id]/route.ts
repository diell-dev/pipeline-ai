/**
 * /api/proposals/[id]
 *
 * PATCH — Update a proposal's fields. Only allowed for draft / pending_admin_approval.
 *   Recomputes totals server-side from line items + discount + tax.
 *
 * DELETE — Soft-delete a proposal (sets deleted_at). Owner / super_admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'
import type { ProposalMaterial } from '@/types/database'

interface ProposalPatchBody {
  // Internal
  measurements?: string | null
  material_list?: ProposalMaterial[]
  estimated_hours?: number | null
  num_techs_needed?: number
  estimated_days?: number
  equipment_list?: string[]
  internal_notes?: string | null
  assigned_to?: string | null
  // Client-facing
  issue_description?: string
  proposed_solution?: string
  discount_enabled?: boolean
  discount_amount?: number
  discount_reason?: string | null
  tax_rate?: number
  valid_until?: string | null
  // Optional new line items (full replacement)
  line_items?: Array<{
    service_catalog_id?: string | null
    service_name: string
    description?: string | null
    quantity?: number
    unit?: string
    unit_price?: number
  }>
}

import { computeProposalTotals as computeTotals } from '@/lib/proposal-totals'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    const body = (await request.json()) as ProposalPatchBody
    const supabase = await createClient()

    // Load existing proposal
    const { data: existing, error: loadError } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', id)
      .single()
    if (loadError || !existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (!canAccessOrg(auth, existing.organization_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Permission model (defense-in-depth — RLS in migration 006 mirrors this):
    //   - Managers (super_admin / owner / office_manager) can edit drafts or
    //     proposals submitted for approval (pending_admin_approval).
    //   - The creator (typically a field tech) can ONLY edit drafts. Once they
    //     submit for approval, they lose edit rights so they can't change
    //     pricing behind the manager's back.
    const isManager = ['super_admin', 'owner', 'office_manager'].includes(auth.role)
    const isCreator = existing.created_by === auth.userId

    if (isManager) {
      if (!['draft', 'pending_admin_approval'].includes(existing.status)) {
        return NextResponse.json(
          { error: `Proposal in status '${existing.status}' cannot be edited` },
          { status: 400 }
        )
      }
    } else if (isCreator) {
      if (existing.status !== 'draft') {
        return NextResponse.json(
          { error: 'Only managers can edit a proposal after it has been submitted for approval' },
          { status: 403 }
        )
      }
    } else {
      return NextResponse.json({ error: 'You cannot edit this proposal' }, { status: 403 })
    }

    // Material cost total
    let materialList: ProposalMaterial[] = existing.material_list || []
    if (Array.isArray(body.material_list)) {
      materialList = body.material_list
    }
    const materialCostTotal = materialList.reduce(
      (sum, m) => sum + (Number(m.qty) || 0) * (Number(m.cost) || 0),
      0
    )

    // Determine line items for totals computation
    let lineItemsForTotals: Array<{ quantity: number; unit_price: number }>
    if (Array.isArray(body.line_items)) {
      lineItemsForTotals = body.line_items.map((li) => ({
        quantity: Number(li.quantity) || 1,
        unit_price: Number(li.unit_price) || 0,
      }))
    } else {
      const { data: existingLines } = await supabase
        .from('proposal_line_items')
        .select('quantity, unit_price')
        .eq('proposal_id', id)
      lineItemsForTotals = existingLines || []
    }

    const taxRateRaw = typeof body.tax_rate === 'number' ? body.tax_rate : Number(existing.tax_rate)
    const taxRate = Math.min(30, Math.max(0, taxRateRaw || 0)) // clamp 0–30% (L4)
    const discountEnabled =
      typeof body.discount_enabled === 'boolean' ? body.discount_enabled : !!existing.discount_enabled
    const discountAmount =
      typeof body.discount_amount === 'number' ? body.discount_amount : Number(existing.discount_amount) || 0

    const totals = computeTotals({
      lineItems: lineItemsForTotals,
      discountEnabled,
      discountAmount,
      taxRate,
    })

    // Build update payload (only include fields the body explicitly sets)
    const update: Record<string, unknown> = {
      material_list: materialList,
      material_cost_total: Math.round(materialCostTotal * 100) / 100,
      subtotal: totals.subtotal,
      discount_enabled: discountEnabled,
      discount_amount: totals.discount,
      tax_rate: taxRate,
      tax_amount: totals.taxAmount,
      total_amount: totals.total,
    }
    if (body.measurements !== undefined) update.measurements = body.measurements
    if (body.estimated_hours !== undefined) update.estimated_hours = body.estimated_hours
    if (body.num_techs_needed !== undefined) update.num_techs_needed = body.num_techs_needed
    if (body.estimated_days !== undefined) update.estimated_days = body.estimated_days
    if (body.equipment_list !== undefined) update.equipment_list = body.equipment_list
    if (body.internal_notes !== undefined) update.internal_notes = body.internal_notes
    if (body.assigned_to !== undefined) update.assigned_to = body.assigned_to
    if (body.issue_description !== undefined) update.issue_description = body.issue_description
    if (body.proposed_solution !== undefined) update.proposed_solution = body.proposed_solution
    if (body.discount_reason !== undefined) update.discount_reason = body.discount_reason
    if (body.valid_until !== undefined) update.valid_until = body.valid_until || null

    const { data: updated, error: updateError } = await supabase
      .from('proposals')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // If body.line_items is provided, replace existing line items
    if (Array.isArray(body.line_items)) {
      await supabase.from('proposal_line_items').delete().eq('proposal_id', id)
      const fresh = body.line_items.map((li, idx) => ({
        proposal_id: id,
        service_catalog_id: li.service_catalog_id || null,
        service_name: li.service_name,
        description: li.description || null,
        quantity: Number(li.quantity) || 1,
        unit: li.unit || 'flat_rate',
        unit_price: Number(li.unit_price) || 0,
        total: (Number(li.quantity) || 1) * (Number(li.unit_price) || 0),
        sort_order: idx,
      }))
      if (fresh.length > 0) {
        await supabase.from('proposal_line_items').insert(fresh)
      }
    }

    return NextResponse.json({ success: true, proposal: updated })
  } catch (err) {
    console.error('Patch proposal failed:', err)
    return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!hasPermission(auth.role, 'proposals:delete')) {
      return NextResponse.json({ error: 'You do not have permission to delete proposals' }, { status: 403 })
    }
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('proposals')
      .select('id, organization_id')
      .eq('id', id)
      .single()
    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (!canAccessOrg(auth, existing.organization_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase
      .from('proposals')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete proposal failed:', err)
    return NextResponse.json({ error: 'Failed to delete proposal' }, { status: 500 })
  }
}
