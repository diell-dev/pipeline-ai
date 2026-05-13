/**
 * DELETE /api/jobs/[id]/delete
 *
 * Soft-deletes a job and voids its associated invoice.
 * Owner only — enforced by permission check.
 * The invoice number is preserved but marked as 'void'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, canAccessOrg } from '@/lib/api-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params

  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Only owner can delete
    if (!['owner', 'super_admin'].includes(auth.role)) {
      return NextResponse.json({ error: 'Only the owner can delete jobs' }, { status: 403 })
    }

    const supabase = await createClient()

    // Verify job exists and belongs to org
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, organization_id, status')
      .eq('id', jobId)
      .is('deleted_at', null)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!canAccessOrg(auth, job.organization_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()

    // 1. Soft-delete the job
    await supabase
      .from('jobs')
      .update({ deleted_at: now, status: 'cancelled' })
      .eq('id', jobId)

    // 2. Void the associated invoice (don't delete — preserve the number)
    await supabase
      .from('invoices')
      .update({ status: 'void', deleted_at: now })
      .eq('job_id', jobId)

    // 3. Log the action
    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'job_deleted',
      entity_type: 'job',
      entity_id: jobId,
      metadata: { deleted_by: auth.userId, previous_status: job.status },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete job failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    )
  }
}
