/**
 * POST /api/proposals/[id]/send-to-client
 *
 * Transition: admin_approved → sent_to_client.
 * Emails the client a sign-now link to /proposals/sign/[public_token].
 * Uses Resend if RESEND_API_KEY is set; otherwise logs the email.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, apiHasPermission } from '@/lib/api-auth'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

function escHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'proposals:send')) {
      return NextResponse.json({ error: 'You do not have permission to send proposals' }, { status: 403 })
    }
    const supabase = getServiceClient()

    // Fetch full proposal + client + org
    const { data: proposal, error: fetchError } = await supabase
      .from('proposals')
      .select(`
        *,
        clients:client_id ( company_name, primary_contact_name, primary_contact_email ),
        sites:site_id ( address )
      `)
      .eq('id', id)
      .single()
    if (fetchError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (proposal.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (proposal.status !== 'admin_approved') {
      return NextResponse.json(
        { error: `Cannot send a proposal in '${proposal.status}' status` },
        { status: 400 }
      )
    }
    const client = proposal.clients as Record<string, unknown> | null
    const clientEmail = client?.primary_contact_email as string | null
    if (!clientEmail) {
      return NextResponse.json({ error: 'Client has no email address on file' }, { status: 400 })
    }
    if (!proposal.public_token) {
      return NextResponse.json({ error: 'Proposal is missing a public sign token' }, { status: 500 })
    }

    // Org info
    const { data: org } = await supabase
      .from('organizations')
      .select('name, logo_url, primary_color, settings, company_phone, company_email')
      .eq('id', proposal.organization_id)
      .single()

    const orgName = org?.name || 'NY Sewer & Drain'
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      request.nextUrl.origin ||
      'http://localhost:3000'
    const signUrl = `${baseUrl.replace(/\/$/, '')}/proposals/sign/${proposal.public_token}`

    const site = proposal.sites as Record<string, unknown> | null
    const siteAddress = (site?.address as string) || ''
    const clientName = (client?.primary_contact_name as string) || 'Valued Customer'
    const companyName = (client?.company_name as string) || ''

    const html = buildEmailHtml({
      orgName,
      logoUrl: (org?.logo_url as string) || null,
      primaryColor: (org?.primary_color as string) || '#1e3a5f',
      proposalNumber: proposal.proposal_number,
      clientName,
      companyName,
      siteAddress,
      issue: proposal.issue_description,
      solution: proposal.proposed_solution,
      total: Number(proposal.total_amount) || 0,
      signUrl,
      validUntil: proposal.valid_until,
    })

    let emailSent = false
    const resendApiKey = process.env.RESEND_API_KEY
    if (resendApiKey) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(resendApiKey)
        const fromEmail =
          ((org?.settings as Record<string, unknown>)?.from_email as string) ||
          `estimates@${orgName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`

        const { error: sendError } = await resend.emails.send({
          from: `${orgName} <${fromEmail}>`,
          to: clientEmail,
          subject: `Estimate ${proposal.proposal_number} from ${orgName} — Review & Sign`,
          html,
        })
        if (sendError) {
          console.error('Resend error:', sendError)
          return NextResponse.json({ error: `Email failed: ${sendError.message}` }, { status: 500 })
        }
        emailSent = true
      } catch (err) {
        console.error('Resend send failed:', err)
        return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
      }
    } else {
      console.warn('[proposals/send-to-client] RESEND_API_KEY not set — logging email only')
      console.log('=== PROPOSAL EMAIL WOULD BE SENT ===')
      console.log('To:', clientEmail)
      console.log('Sign URL:', signUrl)
      console.log('=== END EMAIL ===')
      emailSent = true
    }

    if (emailSent) {
      const { error: updateError } = await supabase
        .from('proposals')
        .update({
          status: 'sent_to_client',
          sent_to_client_at: new Date().toISOString(),
          sent_to_client_by: auth.userId,
        })
        .eq('id', id)
        .eq('status', 'admin_approved')
      if (updateError) {
        console.error('Status update failed after send:', updateError.message)
      }
    }

    return NextResponse.json({
      success: true,
      sentTo: clientEmail,
      signUrl,
      status: 'sent_to_client',
    })
  } catch (err) {
    console.error('send-to-client failed:', err)
    return NextResponse.json({ error: 'Failed to send proposal' }, { status: 500 })
  }
}

interface EmailInput {
  orgName: string
  logoUrl: string | null
  primaryColor: string
  proposalNumber: string
  clientName: string
  companyName: string
  siteAddress: string
  issue: string
  solution: string
  total: number
  signUrl: string
  validUntil: string | null
}

function buildEmailHtml({
  orgName,
  logoUrl,
  primaryColor,
  proposalNumber,
  clientName,
  companyName,
  siteAddress,
  issue,
  solution,
  total,
  signUrl,
  validUntil,
}: EmailInput): string {
  const validThrough = validUntil
    ? new Date(validUntil).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estimate from ${escHtml(orgName)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 20px;">
    <div style="background: ${escHtml(primaryColor)}; color: white; padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
      ${
        logoUrl
          ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(orgName)}" style="max-height: 48px; max-width: 240px; margin-bottom: 12px;" />`
          : `<h1 style="margin: 0; font-size: 24px; font-weight: 700;">${escHtml(orgName)}</h1>`
      }
      <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Service Estimate ${escHtml(proposalNumber)}</p>
    </div>

    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
      <p style="font-size: 16px; color: #333; margin-top: 0;">
        Dear ${escHtml(clientName)}${companyName ? ` (${escHtml(companyName)})` : ''},
      </p>
      <p style="font-size: 14px; color: #555; line-height: 1.6;">
        Thank you for the opportunity to provide a service estimate${siteAddress ? ` for <strong>${escHtml(siteAddress)}</strong>` : ''}.
        Please review the details below and click the button to electronically approve and sign.
      </p>

      <hr style="border: none; border-top: 2px solid #e5e7eb; margin: 24px 0;">

      <h2 style="font-size: 16px; color: ${escHtml(primaryColor)}; margin-bottom: 8px;">Issue</h2>
      <p style="font-size: 14px; color: #555; line-height: 1.6;">${escHtml(issue)}</p>

      <h2 style="font-size: 16px; color: ${escHtml(primaryColor)}; margin-bottom: 8px; margin-top: 20px;">Proposed Solution</h2>
      <p style="font-size: 14px; color: #555; line-height: 1.6; white-space: pre-wrap;">${escHtml(solution)}</p>

      <div style="background: #f8fafc; border-left: 4px solid ${escHtml(primaryColor)}; padding: 16px 20px; margin: 24px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; font-size: 13px; color: #666;">Estimate Total</p>
        <p style="margin: 4px 0 0; font-size: 28px; font-weight: 700; color: ${escHtml(primaryColor)};">
          $${total.toFixed(2)}
        </p>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${escHtml(signUrl)}"
           style="display: inline-block; background: ${escHtml(primaryColor)}; color: white; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-size: 16px; font-weight: 600; letter-spacing: 0.3px;">
          Review &amp; Sign Estimate
        </a>
      </div>

      ${
        validThrough
          ? `<p style="font-size: 12px; color: #888; text-align: center; margin: 0;">
               This estimate is valid through ${escHtml(validThrough)}.
             </p>`
          : ''
      }

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;">
      <p style="font-size: 13px; color: #888; text-align: center; margin: 0;">
        Questions? Just reply to this email and we'll be in touch.<br>
        — ${escHtml(orgName)}
      </p>
    </div>
    <p style="font-size: 12px; color: #aaa; text-align: center; margin-top: 16px;">
      Powered by Pipeline AI
    </p>
  </div>
</body>
</html>
  `.trim()
}
