/**
 * POST /api/jobs/[id]/generate
 *
 * Auto-generates AI report + invoice for a submitted job.
 * Called automatically after Field Tech submits a job.
 *
 * Flow:
 *   1. Validate job exists and is in 'submitted' status
 *   2. Set status to 'ai_generating'
 *   3. Fetch job data (tech notes, photos, site info, client info)
 *   4. Call Claude AI to generate professional service report
 *   5. Auto-generate invoice from service catalog pricing
 *   6. Save report + invoice to job record
 *   7. Set status to 'pending_review'
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { getApiUser } from '@/lib/api-auth'

// Use service role client (bypasses RLS) for server-side operations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, 'public', any>

function getServiceClient(): ServiceClient {
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
    // ── Auth check: must be authenticated and in the same org ──
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const supabase = getServiceClient()

    // 1. Fetch the job with all related data
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select(`
        *,
        clients:client_id (
          company_name, primary_contact_name, primary_contact_email,
          primary_contact_phone, billing_address, payment_terms
        ),
        sites:site_id (
          name, address, borough, site_type, unit_count,
          pipe_material, drain_types, known_issues, access_instructions
        ),
        submitter:submitted_by ( full_name, email )
      `)
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Verify caller belongs to the same organization
    if (job.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Only process jobs in 'submitted' status (or retry for 'ai_generating')
    if (!['submitted', 'ai_generating'].includes(job.status)) {
      return NextResponse.json(
        { error: `Job is in '${job.status}' status, cannot generate` },
        { status: 400 }
      )
    }

    // 2. Set status to 'ai_generating'
    await supabase
      .from('jobs')
      .update({ status: 'ai_generating' })
      .eq('id', jobId)

    // 3. Fetch organization info for branding + invoice settings
    const { data: org } = await supabase
      .from('organizations')
      .select('name, logo_url, primary_color, settings')
      .eq('id', job.organization_id)
      .single()

    // 4. Fetch the ACTUAL line items the tech selected when creating the job
    const { data: jobLineItems } = await supabase
      .from('job_line_items')
      .select(`
        *,
        service_catalog:service_catalog_id (
          name, code, unit, default_price, description
        )
      `)
      .eq('job_id', jobId)

    // 5. Fetch full service catalog (for fallback matching only)
    const { data: services } = await supabase
      .from('service_catalog')
      .select('*')
      .eq('organization_id', job.organization_id)
      .eq('is_active', true)
      .order('name')

    // 6. Generate AI Report using Claude — pass selected services + notes
    const aiReport = await generateReport({
      job,
      orgName: org?.name || 'NY Sewer & Drain',
      lineItems: jobLineItems || [],
    })

    // 7. Generate Invoice from ACTUAL selected services (not keyword matching)
    const invoice = await generateInvoice({
      job,
      lineItems: jobLineItems || [],
      services: services || [],
      orgName: org?.name || 'NY Sewer & Drain',
      orgSettings: (org?.settings || {}) as Record<string, unknown>,
      supabase,
    })

    // 7. Save report + invoice to job, set status to pending_review
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        ai_report_content: aiReport,
        ai_invoice_content: invoice.invoiceContent,
        status: 'pending_review',
      })
      .eq('id', jobId)

    if (updateError) {
      throw new Error(`Failed to save AI content: ${updateError.message}`)
    }

    // 8. Log activity
    await supabase.from('activity_log').insert({
      organization_id: job.organization_id,
      user_id: job.submitted_by,
      action: 'job_submitted',
      entity_type: 'job',
      entity_id: jobId,
      metadata: {
        ai_generated: true,
        invoice_id: invoice.invoiceId,
        total_amount: invoice.invoiceContent.total_amount,
      },
    })

    return NextResponse.json({
      success: true,
      jobId,
      status: 'pending_review',
      reportGenerated: true,
      invoiceGenerated: !!invoice.invoiceId,
    })
  } catch (err) {
    console.error('AI generation failed:', err)

    // Try to revert status back to submitted so it can be retried
    try {
      const supabase = getServiceClient()
      await supabase
        .from('jobs')
        .update({ status: 'submitted' })
        .eq('id', jobId)
    } catch {
      // ignore revert error
    }

    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'AI generation failed. Job status reverted to submitted.', detail: errMsg },
      { status: 500 }
    )
  }
}

// ============================================================
// AI Report Generation
// ============================================================

interface ReportInput {
  job: Record<string, unknown>
  orgName: string
  lineItems: Array<Record<string, unknown>>
}

async function generateReport({ job, orgName, lineItems }: ReportInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY

  // If no API key, generate a template-based report (fallback)
  if (!apiKey) {
    return generateFallbackReport({ job, orgName, lineItems })
  }

  const anthropic = new Anthropic({ apiKey })

  const site = job.sites as Record<string, unknown> | null
  const client = job.clients as Record<string, unknown> | null
  const photoUrls = Array.isArray(job.photos) ? (job.photos as string[]) : []

  // Build a clear list of services that were actually performed
  const servicesPerformed = lineItems.map((li) => {
    const catalog = li.service_catalog as Record<string, unknown> | null
    const name = catalog?.name || (li.description as string) || 'Service'
    const qty = Number(li.quantity) || 1
    const notes = li.notes as string | null
    return `- ${name} (qty: ${qty})${notes ? ` — ${notes}` : ''}`
  }).join('\n')

  const prompt = `You are a professional report writer for ${orgName}, a commercial drain cleaning and sewer service company in New York City.

Generate a professional SERVICE REPORT for a completed job. This report will be sent directly to the client. Write in a clear, professional tone.

## Job Information:
- Client: ${client?.company_name || 'N/A'}
- Contact: ${client?.primary_contact_name || 'N/A'}
- Site: ${site?.name || 'N/A'}
- Address: ${site?.address || 'N/A'}
- Borough: ${site?.borough || 'N/A'}
- Site Type: ${site?.site_type || 'N/A'}
- Pipe Material: ${(site?.pipe_material || 'unknown').toString().replace('_', ' ')}
- Drain Types: ${Array.isArray(site?.drain_types) ? (site.drain_types as string[]).map((d: string) => d.replace('_', ' ')).join(', ') : 'N/A'}
- Known Issues: ${site?.known_issues || 'None documented'}
- Service Date: ${job.service_date}
- Priority: ${job.priority}
- Number of Photos Taken: ${photoUrls.length}

## Services Performed (selected by the technician):
${servicesPerformed || 'No specific services listed'}

## Technician Field Notes:
${job.tech_notes || 'No notes provided'}

IMPORTANT INSTRUCTIONS:
- The technician's notes are the PRIMARY source of truth. They describe what actually happened on site. Use them heavily to build the report.
- The services list shows what work was billed. Reference each service in the "work_performed" section.
- If the tech notes mention specific observations, problems found, conditions, or details — include ALL of them in the report. Do not omit any technical details.
- If photos were taken (count above), mention that photographic documentation is included in the report.
- Be specific — never use generic filler when the tech notes provide real details.

## Generate the report in this JSON structure:
{
  "title": "Service Report",
  "summary": "2-3 sentence executive summary referencing the actual work described in tech notes",
  "work_performed": [
    "One item per service/task actually performed — be specific based on tech notes"
  ],
  "findings": [
    "Key findings and observations from the technician's notes"
  ],
  "recommendations": [
    "Recommendations for the client based on what was found"
  ],
  "condition_assessment": "Assessment of drain/sewer condition based on tech notes and findings",
  "next_steps": "What the client should expect next or any follow-up needed"
}

Return ONLY valid JSON, no markdown, no code blocks.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        { role: 'user', content: prompt },
      ],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Parse the JSON response
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const report = JSON.parse(cleaned)

    return {
      ...report,
      photos: photoUrls,
      generated_at: new Date().toISOString(),
      generated_by: 'claude-sonnet-4',
      version: 1,
    }
  } catch (err) {
    console.error('Claude API error, using fallback:', err)
    return generateFallbackReport({ job, orgName, lineItems })
  }
}

function generateFallbackReport({ job, orgName, lineItems }: ReportInput) {
  const site = job.sites as Record<string, unknown> | null
  const techNotes = (job.tech_notes as string) || 'Service completed as requested.'
  const photoUrls = Array.isArray(job.photos) ? (job.photos as string[]) : []

  // Build work_performed from actual line items
  const workItems = lineItems.map((li) => {
    const catalog = li.service_catalog as Record<string, unknown> | null
    const name = catalog?.name || (li.description as string) || 'Service'
    return `${name} performed at ${site?.name || 'site'}`
  })

  if (workItems.length === 0) {
    workItems.push(`Drain/sewer service performed at ${site?.name || 'site'}`)
  }

  // Add tech notes as a work item if present
  if (techNotes && techNotes !== 'Service completed as requested.') {
    workItems.push(`Technician observations: ${techNotes}`)
  }

  return {
    title: 'Service Report',
    summary: `${orgName} performed drain/sewer service at ${site?.address || 'the specified location'} on ${job.service_date}. ${workItems.length} service(s) completed by our field technician.${photoUrls.length > 0 ? ` ${photoUrls.length} photo(s) documented.` : ''}`,
    work_performed: workItems,
    findings: [
      'Service completed — detailed findings available upon request.',
    ],
    recommendations: [
      'Regular maintenance recommended to prevent buildup and blockages.',
      'Schedule follow-up inspection if issues persist.',
    ],
    condition_assessment: 'Assessment based on technician observations during service visit.',
    next_steps: 'Report and invoice attached for your records. Contact us with any questions.',
    photos: photoUrls,
    generated_at: new Date().toISOString(),
    generated_by: 'template-fallback',
    version: 1,
  }
}

// ============================================================
// Invoice Generation
// ============================================================

interface InvoiceInput {
  job: Record<string, unknown>
  lineItems: Array<Record<string, unknown>>
  services: Array<Record<string, unknown>>
  orgName: string
  orgSettings: Record<string, unknown>
  supabase: ServiceClient
}

async function generateInvoice({ job, lineItems, services, orgName, orgSettings, supabase }: InvoiceInput) {
  const client = job.clients as Record<string, unknown> | null
  const site = job.sites as Record<string, unknown> | null

  // ── USE the actual line items selected by the tech ──
  // The tech already picked services + quantities on the job form.
  // We use those directly instead of guessing from keywords.
  let invoiceLineItems: Array<{
    service: string
    code: string
    quantity: number
    unit: string
    unit_price: number
    total: number
  }> = []

  if (lineItems.length > 0) {
    // Tech selected specific services — use them as-is
    invoiceLineItems = lineItems.map((li) => {
      const catalog = li.service_catalog as Record<string, unknown> | null
      const name = String(catalog?.name || '') || (li.description as string) || 'Service'
      const code = String(catalog?.code || '') || ''
      const unit = String(catalog?.unit || '') || 'flat_rate'
      const qty = Number(li.quantity) || 1
      const price = Number(li.unit_price) || 0
      return {
        service: name,
        code,
        quantity: qty,
        unit,
        unit_price: price,
        total: Number(li.total_price) || (qty * price),
      }
    })
  } else {
    // No line items (edge case) — add a generic service call
    const generalService =
      services.find(
        (s) =>
          ((s.name as string) || '').toLowerCase().includes('general') ||
          ((s.name as string) || '').toLowerCase().includes('service call')
      ) || services[0]

    if (generalService) {
      const price = Number(generalService.default_price) || 0
      invoiceLineItems.push({
        service: generalService.name as string,
        code: (generalService.code as string) || '',
        quantity: 1,
        unit: (generalService.unit as string) || 'flat_rate',
        unit_price: price,
        total: price,
      })
    }
  }

  // Calculate totals from the actual line items
  const subtotal = invoiceLineItems.reduce((sum, li) => sum + li.total, 0)
  const taxRate = 8.875 // NYC sales tax
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
  const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

  // Determine due date based on client payment terms
  const paymentTerms = (client?.payment_terms as string) || 'net_30'
  const daysMap: Record<string, number> = {
    on_receipt: 0,
    net_15: 15,
    net_30: 30,
    net_60: 60,
  }
  const dueDays = daysMap[paymentTerms] ?? 30
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + dueDays)

  // Generate invoice number: PREFIX-YYYYMMDD-XXX
  // Use custom prefix from org settings, fallback to 'NYSD'
  const prefix = ((orgSettings.invoice_prefix as string) || 'NYSD').toUpperCase()
  const nextNum = (orgSettings.invoice_next_number as number) || null

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  let seqNum: string
  if (nextNum) {
    // Use the configured next number from settings
    seqNum = String(nextNum).padStart(3, '0')
    // Atomically increment the next number in org settings
    await supabase
      .from('organizations')
      .update({
        settings: { ...orgSettings, invoice_next_number: nextNum + 1 },
      })
      .eq('id', job.organization_id)
  } else {
    // Fallback: count existing invoices
    const { count } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', job.organization_id as string)
    seqNum = String((count || 0) + 1).padStart(3, '0')
  }

  const invoiceNumber = `${prefix}-${dateStr}-${seqNum}`

  // Create the invoice record in the database
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      job_id: job.id,
      organization_id: job.organization_id,
      client_id: job.client_id,
      invoice_number: invoiceNumber,
      amount: subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: 'draft',
      due_date: dueDate.toISOString().slice(0, 10),
      paid_amount: 0,
      notes: `Auto-generated for job at ${(site?.address as string) || 'N/A'}`,
    })
    .select()
    .single()

  if (invoiceError) {
    console.error('Failed to create invoice:', invoiceError.message)
  }

  // Note: We do NOT re-insert job_line_items — they already exist from job creation.
  // The old code was creating DUPLICATE line items. This is now fixed.

  const invoiceContent = {
    invoice_number: invoiceNumber,
    client_name: client?.company_name || 'N/A',
    client_contact: client?.primary_contact_name || 'N/A',
    client_email: client?.primary_contact_email || null,
    billing_address: client?.billing_address || null,
    site_address: site?.address || 'N/A',
    service_date: job.service_date,
    org_name: orgName,
    line_items: invoiceLineItems,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    payment_terms: paymentTerms,
    due_date: dueDate.toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
  }

  return {
    invoiceId: invoice?.id || null,
    invoiceContent,
  }
}
