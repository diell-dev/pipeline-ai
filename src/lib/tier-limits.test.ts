/**
 * Tier caps. These gate real spend (AI generations) and real revenue (seats),
 * so the boundary conditions matter.
 */
import { describe, it, expect } from 'vitest'
import { canGenerateAI, canAddUser, getTierConfig } from './tier-limits'

describe('canGenerateAI', () => {
  it('allows usage below the basic tier cap', () => {
    const limit = getTierConfig('basic').maxAiGenerationsPerMonth
    expect(limit).toBeGreaterThan(0)
    expect(canGenerateAI('basic', limit - 1)).toBe(true)
  })

  it('blocks exactly at the cap (off-by-one guard)', () => {
    const limit = getTierConfig('basic').maxAiGenerationsPerMonth
    expect(canGenerateAI('basic', limit)).toBe(false)
    expect(canGenerateAI('basic', limit + 1)).toBe(false)
  })

  it('treats 0 as unlimited on the paid tiers', () => {
    expect(getTierConfig('professional').maxAiGenerationsPerMonth).toBe(0)
    expect(canGenerateAI('professional', 10_000)).toBe(true)
    expect(canGenerateAI('business', 10_000)).toBe(true)
  })
})

describe('canAddUser', () => {
  it('allows a seat below the cap and blocks at it', () => {
    const max = getTierConfig('basic').maxUsers
    expect(canAddUser('basic', max - 1)).toBe(true)
    expect(canAddUser('basic', max)).toBe(false)
  })
})
