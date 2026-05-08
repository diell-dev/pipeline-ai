/**
 * Proposal totals computation — single source of truth.
 *
 * Used by both POST /api/proposals (create) and PATCH /api/proposals/[id]
 * (update). Always recomputed server-side from line items + discount + tax
 * so the client can never lie about totals.
 *
 * All monetary values are rounded to 2 decimals.
 */

export interface ProposalLine {
  quantity: number
  unit_price: number
}

export interface ProposalTotalsInput {
  lineItems: ProposalLine[]
  discountEnabled: boolean
  discountAmount: number
  taxRate: number   // percentage, e.g. 8.875 for NYC
}

export interface ProposalTotals {
  subtotal: number
  discount: number
  taxAmount: number
  total: number
}

export function computeProposalTotals({
  lineItems,
  discountEnabled,
  discountAmount,
  taxRate,
}: ProposalTotalsInput): ProposalTotals {
  const subtotal = lineItems.reduce(
    (sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unit_price) || 0),
    0
  )
  const discount = discountEnabled
    ? Math.max(0, Math.min(discountAmount, subtotal))
    : 0
  const taxedBase = Math.max(0, subtotal - discount)
  const taxAmount = Math.round(taxedBase * (taxRate / 100) * 100) / 100
  const total = Math.round((taxedBase + taxAmount) * 100) / 100
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    taxAmount,
    total,
  }
}
