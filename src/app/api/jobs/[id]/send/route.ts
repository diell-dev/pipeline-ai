/**
 * POST /api/jobs/[id]/send
 *
 * Sends the AI-generated report + invoice to the client via email.
 * Called after Owner approves the job.
 *
 * Flow:
 *   1. Validate job is approved and has report/invoice content
 *   2. Get client email
 *   3. Build HTML email with report summary + invoice
 *   4. Send via Resend (or fallback log)
 *   5. Update job status to 'sent', record sent_at timestamp
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params

  try {
    const supabase = getServiceClient()

    // 1. Fetch job with all related data
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(`
        *,
        clients:client_id (
          company_name, primary_contact_name, primary_contact_email, billing_address
        ),
        sites:site_id ( name, address, borough ),
        submitter:submitted_by ( full_name )
      `)
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Prevent double-sends: if already sent/completed, stop immediately
    if (['sent', 'completed'].includes(job.status)) {
      return NextResponse.json(
        { error: 'Already sent to client', alreadySent: true },
        { status: 409 }
      )
    }

    if (job.status !== 'approved') {
      return NextResponse.json(
        { error: `Job must be approved before sending. Current status: ${job.status}` },
        { status: 400 }
      )
    }

    if (!job.ai_report_content || !job.ai_invoice_content) {
      return NextResponse.json(
        { error: 'Report and invoice must be generated before sending' },
        { status: 400 }
      )
    }

    const client = job.clients as Record<string, unknown> | null
    const clientEmail = client?.primary_contact_email as string | null

    if (!clientEmail) {
      return NextResponse.json(
        { error: 'Client has no email address on file' },
        { status: 400 }
      )
    }

    // 2. Get organization info
    const { data: org } = await supabase
      .from('organizations')
      .select('name, settings')
      .eq('id', job.organization_id)
      .single()

    const orgName = org?.name || 'NY Sewer & Drain'

    // 3. Build the email
    const report = job.ai_report_content as Record<string, unknown>
    const invoice = job.ai_invoice_content as Record<string, unknown>
    const site = job.sites as Record<string, unknown> | null

    const emailHtml = buildEmailHtml({
      orgName,
      clientName: (client?.primary_contact_name as string) || 'Valued Customer',
      companyName: (client?.company_name as string) || '',
      siteAddress: (site?.address as string) || 'N/A',
      serviceDate: job.service_date as string,
      report,
      invoice,
    })

    // 4. Send via Resend or fallback
    const resendApiKey = process.env.RESEND_API_KEY
    let emailSent = false

    if (resendApiKey) {
      const { Resend } = await import('resend')
      const resend = new Resend(resendApiKey)

      const fromEmail = (org?.settings as Record<string, unknown>)?.from_email as string
        || `reports@${orgName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`

      const { error: sendError } = await resend.emails.send({
        from: `${orgName} <${fromEmail}>`,
        to: clientEmail,
        subject: `Service Report & Invoice — ${(site?.address as string) || 'Your Property'}`,
        html: emailHtml,
      })

      if (sendError) {
        console.error('Resend error:', sendError)
        // Revert status so it can be retried
        await supabase.from('jobs').update({ status: 'approved' }).eq('id', jobId)
        return NextResponse.json(
          { error: `Email failed: ${sendError.message}` },
          { status: 500 }
        )
      }

      emailSent = true
    } else {
      // No Resend key — log the email for development
      console.log('=== EMAIL WOULD BE SENT ===')
      console.log('To:', clientEmail)
      console.log('Subject: Service Report & Invoice')
      console.log('HTML length:', emailHtml.length)
      console.log('=== END EMAIL ===')
      emailSent = true // Mark as sent for dev purposes
    }

    // 5. Atomic status update: only set to 'sent' if still 'approved'
    // This prevents race conditions if two users try to approve/send simultaneously
    if (emailSent) {
      const { data: updated, error: updateErr } = await supabase
        .from('jobs')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('status', 'approved') // Only succeeds if still approved
        .select('id')
        .single()

      if (updateErr || !updated) {
        // Another request already sent this — that's fine, not an error
        return NextResponse.json({
          success: true,
          emailSent: false,
          alreadySent: true,
          sentTo: clientEmail,
          status: 'sent',
        })
      }

      // Log activity
      await supabase.from('activity_log').insert({
        organization_id: job.organization_id,
        user_id: job.approved_by || job.submitted_by,
        action: 'job_sent_to_client',
        entity_type: 'job',
        entity_id: jobId,
        metadata: {
          client_email: clientEmail,
          invoice_number: invoice.invoice_number,
        },
      })
    }

    return NextResponse.json({
      success: true,
      emailSent,
      sentTo: clientEmail,
      status: 'sent',
    })
  } catch (err) {
    console.error('Send to client failed:', err)
    return NextResponse.json(
      { error: 'Failed to send to client' },
      { status: 500 }
    )
  }
}

// ============================================================
// Email HTML Builder
// ============================================================

interface EmailInput {
  orgName: string
  clientName: string
  companyName: string
  siteAddress: string
  serviceDate: string
  report: Record<string, unknown>
  invoice: Record<string, unknown>
}

function buildEmailHtml({
  orgName,
  clientName,
  companyName,
  siteAddress,
  serviceDate,
  report,
  invoice,
}: EmailInput): string {
  const lineItems = (invoice.line_items as Array<Record<string, unknown>>) || []

  const workPerformed = Array.isArray(report.work_performed)
    ? (report.work_performed as string[]).map((w) => `<li>${w}</li>`).join('')
    : ''

  const findings = Array.isArray(report.findings)
    ? (report.findings as string[]).map((f) => `<li>${f}</li>`).join('')
    : ''

  const recommendations = Array.isArray(report.recommendations)
    ? (report.recommendations as string[]).map((r) => `<li>${r}</li>`).join('')
    : ''

  const lineItemRows = lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${item.service}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right;">$${Number(item.unit_price).toFixed(2)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right;">$${Number(item.total).toFixed(2)}</td>
      </tr>
    `
    )
    .join('')

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Report & Invoice</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">${orgName}</h1>
      <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Service Report & Invoice</p>
    </div>

    <!-- Body -->
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

      <!-- Greeting -->
      <p style="font-size: 16px; color: #333; margin-top: 0;">
        Dear ${clientName}${companyName ? ` (${companyName})` : ''},
      </p>
      <p style="font-size: 14px; color: #555; line-height: 1.6;">
        Please find below the service report and invoice for work completed at
        <strong>${siteAddress}</strong> on <strong>${new Date(serviceDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
      </p>

      <!-- Divider -->
      <hr style="border: none; border-top: 2px solid #e5e7eb; margin: 24px 0;">

      <!-- Report Section -->
      <h2 style="font-size: 18px; color: #1e3a5f; margin-bottom: 12px;">Service Report</h2>

      ${report.summary ? `<p style="font-size: 14px; color: #555; line-height: 1.6; background: #f8fafc; padding: 12px 16px; border-radius: 8px; border-left: 4px solid #2563eb;">${report.summary}</p>` : ''}

      ${workPerformed ? `
        <h3 style="font-size: 15px; color: #333; margin-bottom: 8px;">Work Performed</h3>
        <ul style="font-size: 14px; color: #555; line-height: 1.8; padding-left: 20px;">${workPerformed}</ul>
      ` : ''}

      ${findings ? `
        <h3 style="font-size: 15px; color: #333; margin-bottom: 8px;">Findings</h3>
        <ul style="font-size: 14px; color: #555; line-height: 1.8; padding-left: 20px;">${findings}</ul>
      ` : ''}

      ${recommendations ? `
        <h3 style="font-size: 15px; color: #333; margin-bottom: 8px;">Recommendations</h3>
        <ul style="font-size: 14px; color: #555; line-height: 1.8; padding-left: 20px;">${recommendations}</ul>
      ` : ''}

      ${report.condition_assessment ? `
        <h3 style="font-size: 15px; color: #333; margin-bottom: 8px;">Condition Assessment</h3>
        <p style="font-size: 14px; color: #555; line-height: 1.6;">${report.condition_assessment}</p>
      ` : ''}

      <!-- Divider -->
      <hr style="border: none; border-top: 2px solid #e5e7eb; margin: 24px 0;">

      <!-- Invoice Section -->
      <h2 style="font-size: 18px; color: #1e3a5f; margin-bottom: 4px;">Invoice</h2>
      <p style="font-size: 13px; color: #888; margin-top: 0;">#${invoice.invoice_number || 'N/A'}</p>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
        <thead>
          <tr style="background: #f8fafc;">
            <th style="padding: 10px 12px; text-align: left; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Service</th>
            <th style="padding: 10px 12px; text-align: center; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Qty</th>
            <th style="padding: 10px 12px; text-align: right; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Price</th>
            <th style="padding: 10px 12px; text-align: right; font-weight: 600; color: #333; border-bottom: 2px solid #e5e7eb;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItemRows}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="text-align: right; margin-top: 16px;">
        <p style="font-size: 14px; color: #555; margin: 4px 0;">
          Subtotal: <strong>$${Number(invoice.subtotal).toFixed(2)}</strong>
        </p>
        <p style="font-size: 14px; color: #555; margin: 4px 0;">
          Tax (${invoice.tax_rate}%): <strong>$${Number(invoice.tax_amount).toFixed(2)}</strong>
        </p>
        <p style="font-size: 20px; color: #1e3a5f; font-weight: 700; margin: 12px 0 0;">
          Total: $${Number(invoice.total_amount).toFixed(2)}
        </p>
      </div>

      <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; margin-top: 16px;">
        <p style="font-size: 13px; color: #0369a1; margin: 0;">
          <strong>Payment Terms:</strong> ${((invoice.payment_terms as string) || 'net_30').replace('_', ' ').toUpperCase()}<br>
          <strong>Due Date:</strong> ${invoice.due_date ? new Date(invoice.due_date as string).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
        </p>
      </div>

      <!-- Footer -->
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;">

      <p style="font-size: 13px; color: #888; text-align: center; margin: 0;">
        Thank you for choosing ${orgName}.<br>
        If you have any questions, please don't hesitate to contact us.
      </p>
    </div>

    <!-- Outer Footer -->
    <p style="font-size: 12px; color: #aaa; text-align: center; margin-top: 16px;">
      Powered by Pipeline AI
    </p>
  </div>
</body>
</html>
  `.trim()
}
