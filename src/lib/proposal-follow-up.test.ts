/**
 * Proposal follow-up reminder scheduling (Bogdan's request).
 * Two nudges — day 3 and day 7 — then stop, and never repeat a stage.
 */
import { describe, it, expect } from 'vitest'
import { nextFollowUpStage } from './proposal-follow-up'

describe('nextFollowUpStage', () => {
  it('sends nothing before day 3', () => {
    expect(nextFollowUpStage(0, 0)).toBe(0)
    expect(nextFollowUpStage(2, 0)).toBe(0)
  })

  it('sends stage 1 from day 3 to day 6', () => {
    expect(nextFollowUpStage(3, 0)).toBe(1)
    expect(nextFollowUpStage(6, 0)).toBe(1)
  })

  it('sends stage 2 from day 7', () => {
    expect(nextFollowUpStage(7, 0)).toBe(2)
    expect(nextFollowUpStage(30, 0)).toBe(2)
  })

  it('never repeats a stage already sent', () => {
    expect(nextFollowUpStage(4, 1)).toBe(0) // day-3 already sent, not yet day 7
    expect(nextFollowUpStage(10, 2)).toBe(0) // both sent — done forever
  })

  it('jumps straight to stage 2 if it first qualifies past day 7', () => {
    // e.g. the cron missed a run, or the proposal aged past 7 before any send.
    expect(nextFollowUpStage(8, 0)).toBe(2)
  })

  it('still sends stage 2 when only stage 1 was sent', () => {
    expect(nextFollowUpStage(7, 1)).toBe(2)
  })
})
