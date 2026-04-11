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

    // 3. Fetch organization info for branding
    const { data: org } = await supabase
      .from('organizations')
      .select('name, logo_url, primary_color')
      .eq('id', job.organization_id)
      .single()

    // 4. Fetch service catalog for invoice generation
    const { data: services } = await supabase
      .from('service_catalog')
      .select('*')
      .eq('organization_id', job.organization_id)
      .eq('is_active', true)
      .order('name')

    // 5. Generate AI Report using Claude
    const aiReport = await generateReport({
      job,
      orgName: org?.name || 'NY Sewer & Drain',
    })

    // 6. Generate Invoice from service catalog
    const invoice = await generateInvoice({
      job,
      services: services || [],
      orgName: org?.name || 'NY Sewer & Drain',
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
}

async function generateReport({ job, orgName }: ReportInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY

  // If no API key, generate a template-based report (fallback)
  if (!apiKey) {
    return generateFallbackReport({ job, orgName })
  }

  const anthropic = new Anthropic({ apiKey })

  const site = job.sites as Record<string, unknown> | null
  const client = job.clients as Record<string, unknown> | null

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
- Number of Photos: ${Array.isArray(job.photos) ? (job.photos as string[]).length : 0}

## Technician Notes:
${job.tech_notes || 'No notes provided'}

## Generate the report in this JSON structure:
{
  "title": "Service Report",
  "summary": "2-3 sentence executive summary of work performed",
  "work_performed": [
    "List each task/service performed as a separate item"
  ],
  "findings": [
    "List key findings and observations"
  ],
  "recommendations": [
    "List any recommendations for the client (maintenance, follow-up work, etc.)"
  ],
  "condition_assessment": "Brief assessment of the overall drain/sewer condition",
  "next_steps": "What the client should expect next or any follow-up needed"
}

IMPORTANT: Return ONLY valid JSON, no markdown, no code blocks. Be specific and professional. Reference actual details from the tech notes. If tech notes are minimal, still generate a reasonable professional report based on the available information.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
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
      generated_at: new Date().toISOString(),
      generated_by: 'claude-sonnet-4',
      version: 1,
    }
  } catch (err) {
    console.error('Claude API error, using fallback:', err)
    return generateFallbackReport({ job, orgName })
  }
}

function generateFallbackReport({ job, orgName }: ReportInput) {
  const site = job.sites as Record<string, unknown> | null
  const techNotes = (job.tech_notes as string) || 'Service completed as requested.'

  return {
    title: 'Service Report',
    summary: `${orgName} performed drain/sewer service at ${site?.address || 'the specified location'} on ${job.service_date}. Work was completed by our field technician.`,
    work_performed: [
      `Drain/sewer service performed at ${site?.name || 'site'}`,
      ...(techNotes ? [`Technician notes: ${techNotes}`] : []),
    ],
    findings: [
      'Service completed — detailed findings available upon request.',
    ],
    recommendations: [
      'Regular maintenance recommended to prevent buildup and blockages.',
      'Schedule follow-up inspection if issues persist.',
    ],
    condition_assessment: 'Assessment based on technician observations during service visit.',
    next_steps: 'Report and invoice attached for your records. Contact us with any questions.',
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
  services: Array<Record<string, unknown>>
  orgName: string
  supabase: ServiceClient
}

async function generateInvoice({ job, services, orgName, supabase }: InvoiceInput) {
  const client = job.clients as Record<string, unknown> | null
  const site = job.sites as Record<string, unknown> | null

  // Try to match services from tech notes using AI or keyword matching
  const matchedServices = matchServicesToJob(
    (job.tech_notes as string) || '',
    services,
    site
  )

  // Calculate totals
  const subtotal = matchedServices.reduce((sum, s) => sum + s.total_price, 0)
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

  // Generate invoice number: NYSD-YYYYMMDD-XXX
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', job.organization_id as string)

  const seqNum = String((count || 0) + 1).padStart(3, '0')
  const invoiceNumber = `NYSD-${dateStr}-${seqNum}`

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

  // Create line items
  if (invoice) {
    for (const svc of matchedServices) {
      await supabase.from('job_line_items').insert({
        job_id: job.id as string,
        service_catalog_id: svc.service_catalog_id,
        quantity: svc.quantity,
        unit_price: svc.unit_price,
        total_price: svc.total_price,
        notes: svc.notes || null,
      })
    }
  }

  const invoiceContent = {
    invoice_number: invoiceNumber,
    client_name: client?.company_name || 'N/A',
    client_contact: client?.primary_contact_name || 'N/A',
    client_email: client?.primary_contact_email || null,
    billing_address: client?.billing_address || null,
    site_address: site?.address || 'N/A',
    service_date: job.service_date,
    org_name: orgName,
    line_items: matchedServices.map((s) => ({
      service: s.service_name,
      code: s.service_code,
      quantity: s.quantity,
      unit: s.unit,
      unit_price: s.unit_price,
      total: s.total_price,
    })),
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

// ============================================================
// Service Matching (keyword-based)
// ============================================================

interface MatchedService {
  service_catalog_id: string
  service_name: string
  service_code: string
  quantity: number
  unit: string
  unit_price: number
  total_price: number
  notes: string | null
}

function matchServicesToJob(
  techNotes: string,
  services: Array<Record<string, unknown>>,
  site: Record<string, unknown> | null
): MatchedService[] {
  const notes = techNotes.toLowerCase()
  const matched: MatchedService[] = []
  const matchedIds = new Set<string>()

  // Keywords to match services
  const keywordMap: Record<string, string[]> = {
    // Drain cleaning keywords
    jet: ['jet', 'jetting', 'hydro', 'water jet', 'high pressure'],
    snake: ['snake', 'snaking', 'cable', 'auger', 'rod'],
    camera: ['camera', 'inspection', 'video', 'scope', 'cctv'],
    grease: ['grease', 'trap', 'interceptor', 'foi', 'grease trap'],
    root: ['root', 'roots', 'root cutting', 'root removal'],
    drain: ['drain', 'floor drain', 'clogged', 'blockage', 'backup'],
    sewer: ['sewer', 'main', 'mainline', 'sewer line'],
    storm: ['storm', 'storm drain', 'catch basin'],
    roof: ['roof', 'roof drain', 'leader'],
    emergency: ['emergency', 'flood', 'overflow', 'backup'],
    pump: ['pump', 'sump', 'ejector', 'pump out'],
    maintenance: ['maintenance', 'preventive', 'scheduled', 'routine', 'regular'],
  }

  for (const service of services) {
    const svcName = ((service.name as string) || '').toLowerCase()
    const svcCode = ((service.code as string) || '').toLowerCase()
    const svcDesc = ((service.description as string) || '').toLowerCase()
    const svcId = service.id as string

    if (matchedIds.has(svcId)) continue

    // Check each keyword group
    for (const keywords of Object.values(keywordMap)) {
      const noteMatch = keywords.some((kw) => notes.includes(kw))
      const svcMatch = keywords.some(
        (kw) => svcName.includes(kw) || svcCode.includes(kw) || svcDesc.includes(kw)
      )

      if (noteMatch && svcMatch) {
        matchedIds.add(svcId)
        const price = Number(service.default_price) || 0
        matched.push({
          service_catalog_id: svcId,
          service_name: service.name as string,
          service_code: service.code as string,
          quantity: 1,
          unit: service.unit as string,
          unit_price: price,
          total_price: price,
          notes: `Matched from tech notes`,
        })
        break
      }
    }
  }

  // If no services matched, add a default "General Service" line
  if (matched.length === 0) {
    // Find the most generic drain cleaning service or use the first one
    const generalService =
      services.find(
        (s) =>
          ((s.name as string) || '').toLowerCase().includes('general') ||
          ((s.name as string) || '').toLowerCase().includes('service call')
      ) || services[0]

    if (generalService) {
      const price = Number(generalService.default_price) || 0
      matched.push({
        service_catalog_id: generalService.id as string,
        service_name: generalService.name as string,
        service_code: generalService.code as string,
        quantity: 1,
        unit: generalService.unit as string,
        unit_price: price,
        total_price: price,
        notes: 'Default service — verify and update as needed',
      })
    }
  }

  // Check drain types from site to add quantity context
  if (site?.drain_types && Array.isArray(site.drain_types)) {
    const drainCount = (site.drain_types as string[]).length
    // Update quantities for per_drain services
    for (const m of matched) {
      if (m.unit === 'per_drain' && drainCount > 1) {
        m.quantity = drainCount
        m.total_price = m.unit_price * drainCount
      }
    }
  }

  return matched
}
