/**
 * POST /api/test-ai
 *
 * Sandbox endpoint: runs the same AI pricing analysis + report generation
 * as the real workflow, but saves NOTHING to the database.
 * For testing/debugging the AI pipeline only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiUser } from '@/lib/api-auth'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  try {
    // Auth check — only logged-in users can test
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json()
    const {
      techNotes = '',
      lineItems = [],
    } = body as {
      techNotes: string
      lineItems: Array<{ name: string; code: string; quantity: number; unitPrice: number }>
    }

    if (!techNotes.trim()) {
      return NextResponse.json({ error: 'Please enter some tech notes to test' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 })
    }

    const anthropic = new Anthropic({ apiKey })

    // ── Step 1: Analyze tech notes for pricing adjustments ──
    const serviceList = lineItems.map((li: { name: string; code: string; quantity: number; unitPrice: number }, idx: number) => {
      const total = li.quantity * li.unitPrice
      return `  ${idx}: "${li.name}" (${li.code}) — qty: ${li.quantity}, unit_price: $${li.unitPrice.toFixed(2)}, total: $${total.toFixed(2)}`
    }).join('\n')

    const pricingResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `You are an invoice assistant. Analyze the technician's notes below for any pricing adjustments that should be applied to the invoice.

## Technician Notes:
"${techNotes}"

## Current Line Items:
${serviceList || '  (no services listed)'}

Look for:
- Discounts (percentage or fixed amount) — e.g. "50% discount", "$25 off", "client gets 20% off"
- Surcharges — e.g. "emergency call surcharge", "after-hours +$50"
- Waivers — e.g. "no charge", "waive the fee", "complimentary"
- Any other pricing instructions from the technician

Return ONLY valid JSON (no markdown, no code blocks):
{
  "adjustments": [
    {
      "type": "discount_percent" | "discount_fixed" | "surcharge_percent" | "surcharge_fixed" | "waiver",
      "value": <number>,
      "reason": "<brief reason from the notes>",
      "appliesToAll": true | false,
      "serviceIndex": <number or null>
    }
  ],
  "summary": "<one sentence summary of all adjustments, or empty string if none>"
}

If there are NO pricing adjustments mentioned in the notes, return:
{"adjustments": [], "summary": ""}`,
        },
      ],
    })

    const pricingText = pricingResponse.content[0].type === 'text' ? pricingResponse.content[0].text : '{}'
    const pricingCleaned = pricingText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const pricingAnalysis = JSON.parse(pricingCleaned)

    // ── Step 2: Calculate what the invoice would look like ──
    const invoiceLines = lineItems.map((li: { name: string; code: string; quantity: number; unitPrice: number }) => ({
      service: li.name,
      code: li.code,
      quantity: li.quantity,
      unit_price: li.unitPrice,
      total: li.quantity * li.unitPrice,
    }))

    // Apply adjustments
    const adjustmentLines: Array<{ service: string; code: string; quantity: number; unit_price: number; total: number }> = []
    const itemsSubtotal = invoiceLines.reduce((sum: number, li: { total: number }) => sum + li.total, 0)

    for (const adj of (pricingAnalysis.adjustments || [])) {
      if (adj.type === 'discount_percent') {
        const pct = Math.min(adj.value, 100)
        if (adj.appliesToAll || adj.serviceIndex === undefined || adj.serviceIndex === null) {
          const amt = Math.round(itemsSubtotal * (pct / 100) * 100) / 100
          adjustmentLines.push({ service: `Discount: ${adj.reason}`, code: 'DISC', quantity: 1, unit_price: -amt, total: -amt })
        } else if (adj.serviceIndex >= 0 && adj.serviceIndex < invoiceLines.length) {
          const target = invoiceLines[adj.serviceIndex]
          const amt = Math.round(target.total * (pct / 100) * 100) / 100
          adjustmentLines.push({ service: `Discount on ${target.service}: ${adj.reason}`, code: 'DISC', quantity: 1, unit_price: -amt, total: -amt })
        }
      } else if (adj.type === 'discount_fixed') {
        adjustmentLines.push({ service: `Discount: ${adj.reason}`, code: 'DISC', quantity: 1, unit_price: -Math.abs(adj.value), total: -Math.abs(adj.value) })
      } else if (adj.type === 'surcharge_percent') {
        const amt = Math.round(itemsSubtotal * (adj.value / 100) * 100) / 100
        adjustmentLines.push({ service: `Surcharge: ${adj.reason}`, code: 'SRCH', quantity: 1, unit_price: amt, total: amt })
      } else if (adj.type === 'surcharge_fixed') {
        adjustmentLines.push({ service: `Surcharge: ${adj.reason}`, code: 'SRCH', quantity: 1, unit_price: adj.value, total: adj.value })
      } else if (adj.type === 'waiver') {
        adjustmentLines.push({ service: `Waiver: ${adj.reason}`, code: 'WAIV', quantity: 1, unit_price: -itemsSubtotal, total: -itemsSubtotal })
      }
    }

    const allLines = [...invoiceLines, ...adjustmentLines]
    const subtotal = Math.max(0, allLines.reduce((sum: number, li: { total: number }) => sum + li.total, 0))
    const taxRate = 8.875
    const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

    // ── Step 3: Generate a mini AI report ──
    const servicesPerformed = lineItems.map((li: { name: string; quantity: number }) => `- ${li.name} (qty: ${li.quantity})`).join('\n')

    const reportResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `You are a report writer for a NYC drain/sewer service company. Generate a SERVICE REPORT from these field notes.

## Services Performed:
${servicesPerformed || 'No services listed'}

## Technician Field Notes:
${techNotes}

## Pricing Adjustments Applied:
${pricingAnalysis.summary || 'No special pricing adjustments'}

IMPORTANT: The tech notes are the PRIMARY source of truth. Extract every detail — conditions found, work done, observations. Be specific.

Return ONLY valid JSON:
{
  "title": "Service Report",
  "summary": "2-3 sentence summary",
  "work_performed": ["specific items based on notes"],
  "findings": ["what was found/observed"],
  "recommendations": ["suggestions for client"]
}`,
        },
      ],
    })

    const reportText = reportResponse.content[0].type === 'text' ? reportResponse.content[0].text : '{}'
    const reportCleaned = reportText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const report = JSON.parse(reportCleaned)

    return NextResponse.json({
      success: true,
      pricingAnalysis,
      invoice: {
        line_items: allLines,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total_amount: totalAmount,
      },
      report,
      _meta: {
        note: 'SANDBOX MODE — nothing was saved to the database',
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('Test AI error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'AI test failed', detail: msg }, { status: 500 })
  }
}
