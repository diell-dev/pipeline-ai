/**
 * Proposal totals — the numbers a client signs and gets billed for.
 * Server-side recomputation is the only defence against a tampered payload,
 * so the rounding and clamping rules need to be pinned down.
 */
import { describe, it, expect } from 'vitest'
import { computeProposalTotals } from './proposal-totals'

const NYC_TAX = 8.875

describe('computeProposalTotals', () => {
  it('computes subtotal, tax and total for a simple proposal', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 2, unit_price: 100 }, { quantity: 1, unit_price: 50 }],
      discountEnabled: false,
      discountAmount: 0,
      taxRate: NYC_TAX,
    })
    expect(t.subtotal).toBe(250)
    expect(t.discount).toBe(0)
    expect(t.taxAmount).toBe(22.19) // 250 * 0.08875 = 22.1875 → 22.19
    expect(t.total).toBe(272.19)
  })

  it('taxes the DISCOUNTED base, not the gross subtotal', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 1, unit_price: 1000 }],
      discountEnabled: true,
      discountAmount: 200,
      taxRate: 10,
    })
    expect(t.subtotal).toBe(1000)
    expect(t.discount).toBe(200)
    expect(t.taxAmount).toBe(80) // 10% of 800, not of 1000
    expect(t.total).toBe(880)
  })

  it('ignores the discount amount when the discount toggle is off', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 1, unit_price: 500 }],
      discountEnabled: false,
      discountAmount: 400,
      taxRate: 0,
    })
    expect(t.discount).toBe(0)
    expect(t.total).toBe(500)
  })

  it('clamps a discount larger than the subtotal so the total never goes negative', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 1, unit_price: 100 }],
      discountEnabled: true,
      discountAmount: 5000,
      taxRate: NYC_TAX,
    })
    expect(t.discount).toBe(100)
    expect(t.taxAmount).toBe(0)
    expect(t.total).toBe(0)
  })

  it('clamps a negative discount to zero', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 1, unit_price: 100 }],
      discountEnabled: true,
      discountAmount: -50,
      taxRate: 0,
    })
    expect(t.discount).toBe(0)
    expect(t.total).toBe(100)
  })

  it('treats an empty proposal as zero rather than NaN', () => {
    const t = computeProposalTotals({
      lineItems: [],
      discountEnabled: false,
      discountAmount: 0,
      taxRate: NYC_TAX,
    })
    expect(t).toEqual({ subtotal: 0, discount: 0, taxAmount: 0, total: 0 })
  })

  it('coerces junk quantities/prices to 0 instead of producing NaN', () => {
    const t = computeProposalTotals({
      // Values arriving from a form can be '' or undefined.
      lineItems: [
        { quantity: Number.NaN, unit_price: 100 },
        { quantity: 1, unit_price: undefined as unknown as number },
        { quantity: 2, unit_price: 25 },
      ],
      discountEnabled: false,
      discountAmount: 0,
      taxRate: 0,
    })
    expect(t.subtotal).toBe(50)
    expect(Number.isNaN(t.total)).toBe(false)
  })

  it('rounds to cents rather than carrying float error', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 3, unit_price: 0.1 }],
      discountEnabled: false,
      discountAmount: 0,
      taxRate: 0,
    })
    // 0.1 * 3 === 0.30000000000000004 in IEEE-754
    expect(t.subtotal).toBe(0.3)
  })

  it('handles a zero tax rate', () => {
    const t = computeProposalTotals({
      lineItems: [{ quantity: 1, unit_price: 199.99 }],
      discountEnabled: false,
      discountAmount: 0,
      taxRate: 0,
    })
    expect(t.taxAmount).toBe(0)
    expect(t.total).toBe(199.99)
  })
})
