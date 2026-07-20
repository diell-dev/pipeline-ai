/**
 * AI usage metering (audit G7).
 *
 * `canGenerateAI(tier, currentCount)` existed in tier-limits.ts from the
 * start, but nothing ever supplied `currentCount` — so the Basic tier's
 * 50-generations-a-month cap was decorative and a Basic org could run up an
 * unbounded Claude + Whisper bill. This module supplies the missing half.
 *
 * Design notes:
 *   - The counter is incremented in Postgres (`increment_ai_usage`) so two
 *     concurrent requests can't both squeeze past the limit.
 *   - The period key is the org's OWN month (audit G4): billing months should
 *     not roll over at 7pm local just because UTC says it's the 1st.
 *   - We COUNT FIRST, then do the expensive call. Slight over-counting on a
 *     failed generation is preferable to giving away free generations, and
 *     the tolerance is generous relative to the cap.
 *   - Metering must never take down the feature: if the counter errors, we
 *     log and allow the request.
 */
import { getTierConfig } from '@/lib/tier-limits'
import { todayInTimeZone, usagePeriodSafe } from '@/lib/timezone'
import type { SubscriptionTier } from '@/types/database'

export type AiUsageKind = 'report' | 'dictation' | 'equipment' | 'other'

export interface AiQuotaResult {
  allowed: boolean
  /** Usage count for the current month AFTER this claim. */
  count: number
  /** 0 means unlimited. */
  limit: number
  message?: string
}

/** 'YYYY-MM' in the organisation's timezone. */
export function usagePeriod(timeZone: string | null | undefined): string {
  return usagePeriodSafe(todayInTimeZone(timeZone))
}

interface RpcCapableClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Claim one AI generation for the org and report whether it is within the
 * tier's monthly allowance.
 *
 * Returns `allowed: false` when the org is over its cap — the caller should
 * respond 402/429 with `message`.
 */
export async function claimAiGeneration(params: {
  supabase: unknown
  organizationId: string
  tier: SubscriptionTier | null | undefined
  timeZone: string | null | undefined
  kind: AiUsageKind
}): Promise<AiQuotaResult> {
  const tier = (params.tier ?? 'basic') as SubscriptionTier
  const limit = getTierConfig(tier).maxAiGenerationsPerMonth

  // 0 means unlimited — skip the round-trip entirely.
  if (limit === 0) {
    return { allowed: true, count: 0, limit: 0 }
  }

  try {
    const client = params.supabase as RpcCapableClient
    const { data, error } = await client.rpc('increment_ai_usage', {
      p_org_id: params.organizationId,
      p_period: usagePeriod(params.timeZone),
      p_kind: params.kind,
    })

    if (error) {
      console.error('AI usage metering failed (allowing request):', error.message)
      return { allowed: true, count: 0, limit }
    }

    const count = typeof data === 'number' ? data : Number(data ?? 0)

    if (count > limit) {
      return {
        allowed: false,
        count,
        limit,
        message: `Your plan includes ${limit} AI generations per month and you've used them all. Upgrade your plan to keep generating.`,
      }
    }

    return { allowed: true, count, limit }
  } catch (err) {
    // Never let the meter break the product.
    console.error('AI usage metering threw (allowing request):', err)
    return { allowed: true, count: 0, limit }
  }
}
