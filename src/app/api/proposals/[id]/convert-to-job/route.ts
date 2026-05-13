/**
 * POST /api/proposals/[id]/convert-to-job
 *
 * Manually converts a client_approved proposal into a Job row.
 * Copies proposal_line_items into job_line_items (matching service_catalog_id).
 * Sets proposal.status = 'converted_to_job' and stores the new job id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!hasPermission(auth.role, 'proposals:convert')) {
      return NextResponse.json({ error: 'You do not have permission to convert proposals' }, { status: 403 })
    }
    const supabase = await createClient()

    const { data: proposal } = await supabase
      .from('proposals')
      .select('*')
      .eq('id', id)
      .single()
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (!canAccessOrg(auth, proposal.organization_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (proposal.status !== 'client_approved') {
      return NextResponse.json(
        { error: `Cannot convert a proposal in '${proposal.status}' status` },
        { status: 400 }
      )
    }
    if (proposal.converted_to_job_id) {
      return NextResponse.json(
        { error: 'Proposal already converted', jobId: proposal.converted_to_job_id },
        { status: 409 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)
    const techNotes = `From signed proposal:\n\n${proposal.issue_description}\n\nProposed solution:\n${proposal.proposed_solution}`

    // Create the job row
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        organization_id: proposal.organization_id,
        client_id: proposal.client_id,
        site_id: proposal.site_id,
        submitted_by: auth.userId,
        status: 'scheduled',
        priority: 'normal',
        service_date: today,
        proposal_id: proposal.id,
        tech_notes: techNotes,
        photos: [],
      })
      .select()
      .single()
    if (jobError || !job) {
      console.error('convert-to-job: failed to create job:', jobError?.message)
      return NextResponse.json({ error: jobError?.message || 'Failed to create job' }, { status: 500 })
    }

    // Copy proposal_line_items → job_line_items.
    // Migration 005 added job_line_items.service_name so custom (non-catalog)
    // services no longer get filtered out.
    const { data: lines } = await supabase
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', id)

    if (lines && lines.length > 0) {
      const jobLines = lines.map((li) => ({
        job_id: job.id,
        service_catalog_id: li.service_catalog_id || null,
        service_name: li.service_name,
        description: li.description || li.service_name,
        quantity: li.quantity,
        unit_price: li.unit_price,
        total_price: li.total,
        notes: null,
      }))
      const { error: liError } = await supabase.from('job_line_items').insert(jobLines)
      if (liError) {
        // Pseudo-transaction: roll back the job we just created so the proposal
        // is not left half-converted.
        console.error('convert-to-job: failed to copy line items, rolling back job:', liError.message)
        await supabase.from('jobs').delete().eq('id', job.id)
        return NextResponse.json(
          { error: `Failed to copy line items: ${liError.message}` },
          { status: 500 }
        )
      }
    }

    // Update proposal to converted_to_job
    const { error: updateError } = await supabase
      .from('proposals')
      .update({
        status: 'converted_to_job',
        converted_to_job_id: job.id,
        converted_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (updateError) {
      console.error('convert-to-job: proposal update failed:', updateError.message)
    }

    // Activity log entry
    await supabase.from('activity_log').insert({
      organization_id: proposal.organization_id,
      user_id: auth.userId,
      action: 'job_created',
      entity_type: 'job',
      entity_id: job.id,
      metadata: { from_proposal_id: proposal.id, proposal_number: proposal.proposal_number },
    })

    return NextResponse.json({ success: true, jobId: job.id })
  } catch (err) {
    console.error('convert-to-job failed:', err)
    return NextResponse.json({ error: 'Failed to convert proposal' }, { status: 500 })
  }
}
