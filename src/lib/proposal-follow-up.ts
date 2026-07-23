/**
 * Pure follow-up-stage logic for proposal reminders, extracted so it can be
 * unit tested without a database or a clock. The cron
 * (/api/internal/cron/proposal-follow-ups) uses the same rules inline; this is
 * the single source of truth for WHEN a reminder is due.
 */
export const FOLLOW_UP_STAGE_1_DAYS = 3
export const FOLLOW_UP_STAGE_2_DAYS = 7

/**
 * Given how many whole days a proposal has been awaiting a client response and
 * the highest reminder stage already sent (0=none, 1=day-3, 2=day-7), return
 * the stage to send now — or 0 for "nothing due".
 */
export function nextFollowUpStage(ageDays: number, lastStage: number): 0 | 1 | 2 {
  if (ageDays >= FOLLOW_UP_STAGE_2_DAYS && lastStage < 2) return 2
  if (ageDays >= FOLLOW_UP_STAGE_1_DAYS && lastStage < 1) return 1
  return 0
}
