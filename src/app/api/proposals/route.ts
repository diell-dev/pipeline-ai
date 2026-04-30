/**
 * /api/proposals
 *
 * POST — Create a new draft proposal (status: 'draft').
 *   Body: { client_id, site_id, ...all proposal fields, line_items? }
 *   Generates proposal_number (EST-YYYYMMDD-001) + 32-char unique public_token.
 *
 * GET — List proposals for the caller's organization (with optional filters).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { getApiUser, apiHasPermission } from '@/lib/api-auth'
import type { ProposalMaterial } from '@/types/database'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

function generatePublicToken(): string {
  // 32 url-safe chars
  return randomBytes(24).toString('base64url').slice(0, 32)
}

interface ProposalInsertBody {
  client_id: string
  site_id?: string | null
  assigned_to?: string | null
  // internal
  measurements?: string | null
  material_list?: ProposalMaterial[]
  material_cost_total?: number
  estimated_hours?: number | null
  num_techs_needed?: number
  estimated_days?: number
  equipment_list?: string[]
  internal_notes?: string | null
  // client-facing
  issue_description: string
  proposed_solution: string
  discount_enabled?: boolean
  discount_amount?: number
  discount_reason?: string | null
  tax_rate?: number
  valid_until?: string | null
  line_items?: Array<{
    service_catalog_id?: string | null
    service_name: string
    description?: string | null
    quantity?: number
    unit?: string
    unit_price?: number
  }>
}

function computeTotals({
  lineItems,
  discountEnabled,
  discountAmount,
  taxRate,
}: {
  lineItems: Array<{ quantity: number; unit_price: number }>
  discountEnabled: boolean
  discountAmount: number
  taxRate: number
}) {
  const subtotal = lineItems.reduce(
    (sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0),
    0
  )
  const discount = discountEnabled ? Math.max(0, Math.min(discountAmount, subtotal)) : 0
  const taxedBase = Math.max(0, subtotal - discount)
  const taxAmount = Math.round(taxedBase * (taxRate / 100) * 100) / 100
  const total = Math.round((taxedBase + taxAmount) * 100) / 100
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    taxAmount,
    total,
  }
}

async function generateProposalNumber(
  supabase: ReturnType<typeof getServiceClient>,
  organizationId: string
): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  // Count proposals for this org with this date prefix
  const { data: existing } = await supabase
    .from('proposals')
    .select('proposal_number')
    .eq('organization_id', organizationId)
    .like('proposal_number', `EST-${dateStr}-%`)

  const count = (existing?.length || 0) + 1
  const seq = String(count).padStart(3, '0')
  return `EST-${dateStr}-${seq}`
}

// ──────────────────────────────────────────
// POST /api/proposals
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'proposals:create')) {
      return NextResponse.json({ error: 'You do not have permission to create proposals' }, { status: 403 })
    }

    const body = (await request.json()) as ProposalInsertBody

    if (!body.client_id) {
      return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
    }
    if (!body.issue_description || !body.proposed_solution) {
      return NextResponse.json(
        { error: 'issue_description and proposed_solution are required' },
        { status: 400 }
      )
    }

    const supabase = getServiceClient()

    // Compute material_cost_total from material_list
    const materialList: ProposalMaterial[] = Array.isArray(body.material_list) ? body.material_list : []
    const materialCostTotal = materialList.reduce(
      (sum, m) => sum + (Number(m.qty) || 0) * (Number(m.cost) || 0),
      0
    )

    // Compute totals from provided line items
    const lineItems = (body.line_items || []).map((li, idx) => ({
      service_catalog_id: li.service_catalog_id || null,
      service_name: li.service_name,
      description: li.description || null,
      quantity: Number(li.quantity) || 1,
      unit: li.unit || 'flat_rate',
      unit_price: Number(li.unit_price) || 0,
      total: (Number(li.quantity) || 1) * (Number(li.unit_price) || 0),
      sort_order: idx,
    }))

    const taxRate = typeof body.tax_rate === 'number' ? body.tax_rate : 8.875
    const totals = computeTotals({
      lineItems,
      discountEnabled: !!body.discount_enabled,
      discountAmount: Number(body.discount_amount) || 0,
      taxRate,
    })

    const proposalNumber = await generateProposalNumber(supabase, auth.organizationId)

    // Generate a unique public_token (retry once if collision)
    let publicToken = generatePublicToken()
    {
      const { data: clash } = await supabase
        .from('proposals')
        .select('id')
        .eq('public_token', publicToken)
        .maybeSingle()
      if (clash) publicToken = generatePublicToken()
    }

    const { data: proposal, error } = await supabase
      .from('proposals')
      .insert({
        organization_id: auth.organizationId,
        client_id: body.client_id,
        site_id: body.site_id || null,
        created_by: auth.userId,
        assigned_to: body.assigned_to || null,
        proposal_number: proposalNumber,
        status: 'draft',
        // internal
        measurements: body.measurements ?? null,
        material_list: materialList,
        material_cost_total: Math.round(materialCostTotal * 100) / 100,
        estimated_hours: body.estimated_hours ?? null,
        num_techs_needed: body.num_techs_needed ?? 1,
        estimated_days: body.estimated_days ?? 1,
        equipment_list: body.equipment_list ?? [],
        internal_notes: body.internal_notes ?? null,
        // client-facing
        issue_description: body.issue_description,
        proposed_solution: body.proposed_solution,
        subtotal: totals.subtotal,
        discount_enabled: !!body.discount_enabled,
        discount_amount: totals.discount,
        discount_reason: body.discount_reason ?? null,
        tax_rate: taxRate,
        tax_amount: totals.taxAmount,
        total_amount: totals.total,
        public_token: publicToken,
        valid_until: body.valid_until || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create proposal:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Insert line items
    if (lineItems.length > 0) {
      const { error: liError } = await supabase
        .from('proposal_line_items')
        .insert(lineItems.map((li) => ({ ...li, proposal_id: proposal.id })))
      if (liError) {
        console.error('Failed to insert proposal line items:', liError.message)
      }
    }

    return NextResponse.json({ success: true, proposal })
  } catch (err) {
    console.error('Create proposal failed:', err)
    return NextResponse.json({ error: 'Failed to create proposal' }, { status: 500 })
  }
}

// ──────────────────────────────────────────
// GET /api/proposals?status=&client_id=
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status')
    const clientFilter = url.searchParams.get('client_id')
    const fromDate = url.searchParams.get('from')
    const toDate = url.searchParams.get('to')

    const supabase = getServiceClient()
    let query = supabase
      .from('proposals')
      .select(`
        *,
        clients:client_id ( company_name ),
        sites:site_id ( name, address ),
        creator:created_by ( full_name )
      `)
      .eq('organization_id', auth.organizationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    // Tech-only sees own
    if (!apiHasPermission(auth.role, 'proposals:view_all')) {
      query = query.eq('created_by', auth.userId)
    }
    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }
    if (clientFilter) {
      query = query.eq('client_id', clientFilter)
    }
    if (fromDate) {
      query = query.gte('created_at', fromDate)
    }
    if (toDate) {
      query = query.lte('created_at', toDate)
    }

    const { data, error } = await query.limit(200)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ proposals: data || [] })
  } catch (err) {
    console.error('List proposals failed:', err)
    return NextResponse.json({ error: 'Failed to list proposals' }, { status: 500 })
  }
}
