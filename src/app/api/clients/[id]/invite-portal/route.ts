/**
 * POST /api/clients/[id]/invite-portal
 *
 * Provisions a CLIENT PORTAL login for a client company. This is the ONLY
 * endpoint allowed to mint a role='client' user (team/invite explicitly
 * refuses it). Owner / office_manager only.
 *
 * Supports many logins per client (invite several contacts, each their own
 * email — all share the same client_id). The client receives a temporary
 * password by email; they can also use the magic-link option on the login
 * page. Mirrors the hardened team-invite flow: email delivery is checked
 * BEFORE the account is created so we never orphan a login.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'
import { escapeHtml } from '@/lib/escape-html'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: clientId } = await params

    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!hasPermission(auth.role, 'clients:invite_portal')) {
      return NextResponse.json({ error: 'You do not have permission to invite clients' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const full_name = typeof body.full_name === 'string' && body.full_name.trim()
      ? body.full_name.trim()
      : email
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    const supabase = createClient(url, serviceKey)

    // Load the client and confirm it belongs to the caller's org.
    const { data: client } = await supabase
      .from('clients')
      .select('id, organization_id, company_name')
      .eq('id', clientId)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; organization_id: string; company_name: string }>()
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }
    if (!canAccessOrg(auth, client.organization_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fail BEFORE creating the account if we can't deliver credentials in prod.
    if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'Email provider not configured — cannot invite clients' },
        { status: 500 }
      )
    }

    // Already a user in this org with that email?
    const { data: existing } = await supabase
      .from('users')
      .select('id, role, client_id, is_active')
      .eq('email', email)
      .eq('organization_id', client.organization_id)
      .maybeSingle<{ id: string; role: string; client_id: string | null; is_active: boolean }>()
    if (existing) {
      if (existing.role !== 'client' || existing.client_id !== client.id) {
        return NextResponse.json(
          { error: 'This email already belongs to another account in your organization.' },
          { status: 409 }
        )
      }
      // Reactivate an existing client login for this client.
      await supabase.from('users').update({ is_active: true, full_name }).eq('id', existing.id)
      // Note: reactivation keeps the user's EXISTING password (we don't mint a
      // new one here), so must_change_password is deliberately left untouched.
      await sendInviteEmail(email, full_name, client.company_name, null)
      return NextResponse.json({ success: true, reactivated: true })
    }

    // Crypto-strong temp password.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
    const tempPassword = Array.from(
      crypto.getRandomValues(new Uint8Array(24)),
      (b) => chars[b % chars.length]
    ).join('')

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      // S8: see team/invite — enforced by middleware from the JWT.
      app_metadata: {
        must_change_password: true,
        password_set_at: new Date().toISOString(),
      },
    })
    if (authErr || !authData?.user) {
      if (authErr?.message?.includes('already been registered')) {
        return NextResponse.json(
          { error: 'This email already has an account. Contact support if unexpected.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: authErr?.message || 'Failed to create login' }, { status: 500 })
    }

    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        organization_id: client.organization_id,
        client_id: client.id,
        email,
        full_name,
        role: 'client',
        is_active: true,
        // S8: emailed temp password — force a change at first sign-in.
        must_change_password: true,
        password_set_at: new Date().toISOString(),
      })
      .select('id, email, full_name')
      .single()

    if (userErr || !newUser) {
      // Roll back the auth user so we don't orphan a login.
      await supabase.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: userErr?.message || 'Failed to create client login' }, { status: 500 })
    }

    await sendInviteEmail(email, full_name, client.company_name, tempPassword)

    // Never return the temp password in the response.
    return NextResponse.json({ success: true, user: newUser })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Client portal invite error:', message)
    return NextResponse.json({ error: 'Failed to invite client' }, { status: 500 })
  }
}

async function sendInviteEmail(
  email: string,
  fullName: string,
  companyName: string,
  tempPassword: string | null
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pipeline-ai-beige.vercel.app'
  const portalUrl = `${appUrl}/portal`
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      // S7: use the single shared escape helper (src/lib/escape-html.ts)
      // rather than a local copy, so there is one implementation to audit.
      const esc = escapeHtml
      const pwLine = tempPassword
        ? `<p>Your temporary password is: <code style="background:#f5f5f5;padding:4px 8px;border-radius:4px;">${esc(tempPassword)}</code><br>You will be asked to choose your own password the first time you sign in. This temporary password stops working after 7 days — you can also use the magic-link option on the sign-in page.</p>`
        : `<p>Sign in with the password you already have, or use the magic-link option on the sign-in page.</p>`
      await resend.emails.send({
        from: 'Pipeline AI <noreply@pipeline-ai.com>',
        to: email,
        subject: `Your ${esc(companyName)} client portal is ready`,
        html: `<p>Hi ${esc(fullName)},</p>
               <p>You now have access to the <strong>${esc(companyName)}</strong> client portal, where you can see your jobs, reports, invoices, and upcoming visits.</p>
               ${pwLine}
               <p><a href="${portalUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Open your portal</a></p>
               <p style="color:#888;font-size:12px;">${portalUrl}</p>`,
      })
    } catch (e) {
      console.error('Client invite email failed:', e)
    }
  } else if (process.env.NODE_ENV !== 'production' && tempPassword) {
    console.log('[DEV] Client portal temp password for', email, ':', tempPassword)
  }
}
