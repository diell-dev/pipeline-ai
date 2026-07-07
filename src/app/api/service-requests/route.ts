/**
 * POST /api/service-requests — a client submits a request for more work.
 *
 * Client-only (role='client' has service_requests:create). Org + client are
 * derived SERVER-SIDE from the caller's profile (never trusted from the body).
 * On success, emails the org's owner/office_managers so the request is acted on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, hasPermission } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const URGENCY = ['low', 'normal', 'high', 'emergency'] as const

export async function POST(req: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!hasPermission(auth.role, 'service_requests:create')) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
    if (!summary) {
      return NextResponse.json({ error: 'Please describe what you need' }, { status: 400 })
    }
    const details = typeof body.details === 'string' ? body.details.trim() : null
    const urgency = URGENCY.includes(body.urgency) ? body.urgency : 'normal'
    const preferred_date = typeof body.preferred_date === 'string' && body.preferred_date ? body.preferred_date : null
    const siteIdRaw = typeof body.site_id === 'string' && body.site_id ? body.site_id : null

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    const supabase = createClient(url, serviceKey)

    // Server-derived org + client from the caller's profile.
    const { data: profile } = await supabase
      .from('users')
      .select('client_id, organization_id')
      .eq('id', auth.userId)
      .maybeSingle<{ client_id: string | null; organization_id: string }>()
    if (!profile?.client_id) {
      return NextResponse.json({ error: 'No client account linked to this login' }, { status: 400 })
    }

    // Validate the site (if any) belongs to this client.
    let site_id: string | null = null
    if (siteIdRaw) {
      const { data: site } = await supabase
        .from('sites').select('id').eq('id', siteIdRaw).eq('client_id', profile.client_id).maybeSingle()
      site_id = site ? siteIdRaw : null
    }

    const { data: inserted, error: insErr } = await supabase
      .from('service_requests')
      .insert({
        organization_id: profile.organization_id,
        client_id: profile.client_id,
        site_id,
        created_by: auth.userId,
        summary,
        details,
        urgency,
        preferred_date,
        status: 'new',
      })
      .select('id')
      .single()
    if (insErr || !inserted) {
      return NextResponse.json({ error: insErr?.message || 'Could not submit request' }, { status: 500 })
    }

    // Notify staff (best-effort — never fail the request on email).
    try {
      if (process.env.RESEND_API_KEY) {
        const [{ data: client }, { data: staff }, { data: site }] = await Promise.all([
          supabase.from('clients').select('company_name').eq('id', profile.client_id).maybeSingle<{ company_name: string }>(),
          supabase.from('users').select('email').eq('organization_id', profile.organization_id)
            .in('role', ['owner', 'office_manager']).eq('is_active', true),
          site_id ? supabase.from('sites').select('name,address').eq('id', site_id).maybeSingle<{ name: string; address: string }>() : Promise.resolve({ data: null }),
        ])
        const to = (staff ?? []).map((s) => (s as { email: string }).email).filter(Boolean)
        if (to.length > 0) {
          const { Resend } = await import('resend')
          const resend = new Resend(process.env.RESEND_API_KEY)
          const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
          const where = site ? ` at ${esc(site.name || site.address || '')}` : ''
          await resend.emails.send({
            from: 'Pipeline AI <noreply@pipeline-ai.com>',
            to,
            subject: `New service request from ${esc(client?.company_name || 'a client')}${urgency === 'emergency' ? ' (EMERGENCY)' : ''}`,
            html: `<p><strong>${esc(client?.company_name || 'A client')}</strong> submitted a service request${where}.</p>
                   <p><strong>Urgency:</strong> ${esc(urgency)}${preferred_date ? `<br><strong>Preferred date:</strong> ${esc(preferred_date)}` : ''}</p>
                   <p><strong>Request:</strong><br>${esc(summary)}</p>
                   ${details ? `<p>${esc(details)}</p>` : ''}`,
          })
        }
      }
    } catch (e) {
      console.error('Service-request notification failed:', e)
    }

    return NextResponse.json({ success: true, id: inserted.id })
  } catch (err) {
    console.error('Service request error:', err)
    return NextResponse.json({ error: 'Could not submit request' }, { status: 500 })
  }
}
