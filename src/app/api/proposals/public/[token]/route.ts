/**
 * GET /api/proposals/public/[token]
 *
 * Returns the client-facing view of a proposal looked up by public_token.
 * Strips internal fields (measurements, equipment_list, internal_notes,
 * material_list, material_cost_total, estimated_*, num_techs_needed).
 *
 * Uses the service-role client to bypass RLS (the token IS the auth).
 * Returns 404 if token unknown, expired, or proposal not in a valid status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

const SIGNABLE_STATUSES = new Set(['sent_to_client', 'admin_approved'])
const POST_SIGN_STATUSES = new Set(['client_approved', 'client_rejected', 'converted_to_job'])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
  }

  try {
    const supabase = getServiceClient()
    const { data: proposal, error } = await supabase
      .from('proposals')
      .select(`
        id, proposal_number, status,
        issue_description, proposed_solution,
        subtotal, discount_enabled, discount_amount, discount_reason,
        tax_rate, tax_amount, total_amount,
        valid_until, sent_to_client_at,
        client_approved_at, client_rejected_at, client_rejection_reason,
        organization_id, client_id, site_id,
        clients:client_id ( company_name, primary_contact_name ),
        sites:site_id ( name, address, borough )
      `)
      .eq('public_token', token)
      .is('deleted_at', null)
      .maybeSingle()

    if (error || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Block statuses that should not show the client view
    if (
      !SIGNABLE_STATUSES.has(proposal.status) &&
      !POST_SIGN_STATUSES.has(proposal.status)
    ) {
      return NextResponse.json({ error: 'Proposal not available' }, { status: 404 })
    }

    // Check expiration
    let expired = false
    if (proposal.valid_until) {
      const validUntilDate = new Date(proposal.valid_until)
      if (validUntilDate.getTime() < Date.now()) expired = true
    }

    // Org branding
    const { data: org } = await supabase
      .from('organizations')
      .select('name, logo_url, primary_color, accent_color, company_phone, company_email, company_website, company_address')
      .eq('id', proposal.organization_id)
      .single()

    // Line items (client-facing only)
    const { data: lineItems } = await supabase
      .from('proposal_line_items')
      .select('id, service_name, description, quantity, unit, unit_price, total, sort_order')
      .eq('proposal_id', proposal.id)
      .order('sort_order', { ascending: true })

    return NextResponse.json({
      proposal: {
        id: proposal.id,
        proposal_number: proposal.proposal_number,
        status: proposal.status,
        issue_description: proposal.issue_description,
        proposed_solution: proposal.proposed_solution,
        subtotal: proposal.subtotal,
        discount_enabled: proposal.discount_enabled,
        discount_amount: proposal.discount_amount,
        discount_reason: proposal.discount_reason,
        tax_rate: proposal.tax_rate,
        tax_amount: proposal.tax_amount,
        total_amount: proposal.total_amount,
        valid_until: proposal.valid_until,
        sent_to_client_at: proposal.sent_to_client_at,
        client_approved_at: proposal.client_approved_at,
        client_rejected_at: proposal.client_rejected_at,
        client_rejection_reason: proposal.client_rejection_reason,
        client: proposal.clients,
        site: proposal.sites,
      },
      line_items: lineItems || [],
      organization: org,
      expired,
      already_signed: !!proposal.client_approved_at,
      already_rejected: !!proposal.client_rejected_at,
    })
  } catch (err) {
    console.error('Public proposal GET failed:', err)
    return NextResponse.json({ error: 'Failed to load proposal' }, { status: 500 })
  }
}
