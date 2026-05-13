/**
 * Pipeline AI — Subscription Tier Limits
 *
 * Defines the feature gates and usage limits for each tier.
 * Checked both in the UI (to show upgrade prompts) and in API routes (to enforce).
 */
import type { SubscriptionTier } from '@/types/database'

export interface TierConfig {
  name: string
  label: string
  maxUsers: number
  additionalUserCost: number // per month
  maxAiGenerationsPerMonth: number // 0 = unlimited
  maxServiceCatalogItems: number // 0 = unlimited
  storageGb: number
  features: {
    approvalWorkflow: boolean
    roleBasedAccess: boolean
    multiSitePerClient: boolean
    industryCrmFields: boolean
    clientPricingOverrides: boolean
    jobHistory: boolean
    financialDashboard: 'none' | 'basic' | 'full' | 'advanced'
    bankStatementUpload: boolean
    plaidIntegration: boolean
    customBranding: boolean
    clientPortal: boolean
    aiRevisionHandling: boolean
    recurringJobs: boolean
    recurringInvoices: boolean
    proposalGeneration: boolean
    multiCrewManagement: boolean
    advancedAnalytics: boolean
    googleReviewAutoReply: boolean
    apiAccess: boolean
    autoSendOnApproval: boolean
    jobScheduling: boolean
    crewManagement: boolean
  }
}

export const TIER_CONFIGS: Record<SubscriptionTier, TierConfig> = {
  basic: {
    name: 'basic',
    label: 'Starter',
    maxUsers: 2,
    additionalUserCost: 0, // no additional users on basic
    maxAiGenerationsPerMonth: 50,
    maxServiceCatalogItems: 20,
    storageGb: 5,
    features: {
      approvalWorkflow: false,
      roleBasedAccess: false,
      multiSitePerClient: false,
      industryCrmFields: false,
      clientPricingOverrides: false,
      jobHistory: false,
      financialDashboard: 'basic',
      bankStatementUpload: false,
      plaidIntegration: false,
      customBranding: false,
      clientPortal: false,
      aiRevisionHandling: false,
      recurringJobs: true,
      recurringInvoices: false,
      proposalGeneration: false,
      multiCrewManagement: true,
      advancedAnalytics: false,
      googleReviewAutoReply: false,
      apiAccess: false,
      autoSendOnApproval: false,
      jobScheduling: true,
      crewManagement: true,
    },
  },

  professional: {
    name: 'professional',
    label: 'Growth',
    maxUsers: 5,
    additionalUserCost: 19,
    maxAiGenerationsPerMonth: 0, // unlimited
    maxServiceCatalogItems: 0, // unlimited
    storageGb: 25,
    features: {
      approvalWorkflow: true,
      roleBasedAccess: true,
      multiSitePerClient: true,
      industryCrmFields: true,
      clientPricingOverrides: true,
      jobHistory: true,
      financialDashboard: 'full',
      bankStatementUpload: true,
      plaidIntegration: false,
      customBranding: true,
      clientPortal: false,
      aiRevisionHandling: false,
      recurringJobs: true,
      recurringInvoices: false,
      proposalGeneration: false,
      multiCrewManagement: true,
      advancedAnalytics: false,
      googleReviewAutoReply: false,
      apiAccess: false,
      autoSendOnApproval: true,
      jobScheduling: true,
      crewManagement: true,
    },
  },

  business: {
    name: 'business',
    label: 'Full Operations',
    maxUsers: 15,
    additionalUserCost: 15,
    maxAiGenerationsPerMonth: 0, // unlimited
    maxServiceCatalogItems: 0, // unlimited
    storageGb: 100,
    features: {
      approvalWorkflow: true,
      roleBasedAccess: true,
      multiSitePerClient: true,
      industryCrmFields: true,
      clientPricingOverrides: true,
      jobHistory: true,
      financialDashboard: 'advanced',
      bankStatementUpload: true,
      plaidIntegration: true,
      customBranding: true,
      clientPortal: true,
      aiRevisionHandling: true,
      recurringJobs: true,
      recurringInvoices: true,
      proposalGeneration: true,
      multiCrewManagement: true,
      advancedAnalytics: true,
      googleReviewAutoReply: true,
      apiAccess: true,
      autoSendOnApproval: true,
      jobScheduling: true,
      crewManagement: true,
    },
  },
}

/**
 * Get the tier config for an organization
 */
export function getTierConfig(tier: SubscriptionTier): TierConfig {
  return TIER_CONFIGS[tier] || TIER_CONFIGS.basic
}

/**
 * Check if a specific feature is available on a tier
 */
export function hasFeature(
  tier: SubscriptionTier,
  feature: keyof TierConfig['features']
): boolean {
  const config = TIER_CONFIGS[tier]
  const value = config.features[feature]
  // Handle boolean and string features
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value !== 'none'
  return false
}

/**
 * Check if AI generation limit has been reached
 * Returns true if still within limits (or unlimited)
 */
export function canGenerateAI(tier: SubscriptionTier, currentCount: number): boolean {
  const limit = TIER_CONFIGS[tier].maxAiGenerationsPerMonth
  if (limit === 0) return true // unlimited
  return currentCount < limit
}

/**
 * Check if user limit has been reached
 */
export function canAddUser(tier: SubscriptionTier, currentUserCount: number): boolean {
  return currentUserCount < TIER_CONFIGS[tier].maxUsers
}
