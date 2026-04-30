/**
 * Pipeline AI — Database Types
 *
 * These types mirror the Supabase database schema.
 * They're the single source of truth for data shapes across the app.
 */

// ============================================================
// Enums
// ============================================================

export type UserRole = 'super_admin' | 'owner' | 'office_manager' | 'field_tech' | 'client'

export type ClientType = 'property_mgmt' | 'landlord' | 'commercial' | 'residential' | 'contractor'

export type PaymentTerms = 'on_receipt' | 'net_15' | 'net_30' | 'net_60' | 'custom'

export type ServiceContractType = 'one_time' | 'recurring' | 'emergency'

export type SiteType = 'residential' | 'commercial' | 'industrial' | 'mixed_use'

export type DrainType = 'floor_drain' | 'sewer_line' | 'grease_trap' | 'storm_drain' | 'roof_drain'

export type PipeMaterial = 'cast_iron' | 'pvc' | 'clay' | 'copper' | 'unknown'

export type ServiceUnit = 'per_drain' | 'per_line' | 'per_trap' | 'flat_rate' | 'hourly'

export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly'

export type JobStatus =
  | 'scheduled'
  | 'submitted'
  | 'ai_generating'
  | 'pending_review'
  | 'approved'
  | 'sent'
  | 'revision_requested'
  | 'revised'
  | 'rejected'
  | 'completed'
  | 'cancelled'

export type JobPriority = 'normal' | 'urgent' | 'emergency'

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'void'

export type PaymentMethod = 'check' | 'ach' | 'wire' | 'credit_card' | 'cash' | 'other'

export type MatchStatus = 'unmatched' | 'suggested' | 'confirmed' | 'rejected'

export type SubscriptionTier = 'basic' | 'professional' | 'business'

// ============================================================
// Organization (multi-tenant root)
// ============================================================

export type InvoiceTheme = 'modern' | 'classic' | 'minimal' | 'bold'

export type DocPillarType = 'logo' | 'company_info' | 'page_number' | 'empty'
export type DocPillarAlignment = 'left' | 'center' | 'right'

export interface DocPillar {
  type: DocPillarType
  alignment: DocPillarAlignment
}

export interface DocHeaderFooterLayout {
  left: DocPillar
  center: DocPillar
  right: DocPillar
}

export interface OrganizationSettings {
  invoice_theme?: InvoiceTheme
  header?: DocHeaderFooterLayout
  footer?: DocHeaderFooterLayout
  invoice_prefix?: string // e.g. "NYSD", "INV", custom prefix for invoice numbers
  invoice_next_number?: number // next sequential number (auto-increments)
}

export interface Organization {
  id: string
  name: string
  slug: string // URL-friendly identifier
  tier: SubscriptionTier
  // Branding
  logo_url: string | null
  primary_color: string // hex, e.g. "#05093d"
  accent_color: string  // hex, e.g. "#00ff85"
  secondary_color: string | null
  // Company info
  company_phone: string | null
  company_email: string | null
  company_website: string | null
  company_address: string | null
  // Document settings (invoice theme, header/footer layout)
  settings: OrganizationSettings
  // Limits
  max_users: number
  max_ai_generations_per_month: number
  storage_limit_gb: number
  // Billing
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  // Stripe Connect (Migration 004) — for accepting card payments on invoices
  stripe_account_id: string | null
  stripe_account_status: 'pending' | 'active' | 'restricted' | 'disconnected' | null
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
  // Metadata
  created_at: string
  updated_at: string
}

// ============================================================
// Users
// ============================================================

export interface User {
  id: string
  organization_id: string
  email: string
  full_name: string
  role: UserRole
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// ============================================================
// Clients (CRM)
// ============================================================

export interface Client {
  id: string
  organization_id: string
  company_name: string
  client_type: ClientType
  primary_contact_name: string
  primary_contact_phone: string | null
  primary_contact_email: string | null
  billing_contact_name: string | null
  billing_contact_email: string | null
  billing_address: string | null
  payment_terms: PaymentTerms
  service_contract_type: ServiceContractType
  insurance_coi_on_file: boolean
  insurance_expiry_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ============================================================
// Sites (nested under clients)
// ============================================================

export interface Site {
  id: string
  client_id: string
  organization_id: string
  name: string
  address: string
  borough: string | null
  site_type: SiteType
  unit_count: number | null
  access_instructions: string | null
  drain_types: DrainType[]
  pipe_material: PipeMaterial
  known_issues: string | null
  equipment_notes: string | null
  reference_photos: string[] // storage URLs
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ============================================================
// Service Catalog
// ============================================================

export interface ServiceCatalogItem {
  id: string
  organization_id: string
  code: string
  name: string
  description: string | null
  default_price: number
  unit: ServiceUnit
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ClientPricingOverride {
  id: string
  client_id: string
  service_catalog_id: string
  custom_price: number
  notes: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Jobs
// ============================================================

export interface Job {
  id: string
  organization_id: string
  client_id: string
  site_id: string
  submitted_by: string // user id
  assigned_to: string | null // technician user id (for dispatch)
  status: JobStatus
  priority: JobPriority
  service_date: string
  scheduled_time: string | null // ISO time for dispatch scheduling
  scheduled_end_time: string | null // estimated end for calendar blocks
  estimated_duration_minutes: number | null
  arrival_time: string | null // when tech arrived on site
  completion_time: string | null // when job was finished
  // Scheduling metadata (Business tier)
  scheduled_by: string | null // manager who scheduled this job
  original_scheduled_time: string | null // if rescheduled, the original time
  reschedule_reason: string | null
  crew_id: string | null // crew assignment (null = individual tech)
  recurring_schedule_id: string | null // link to recurring pattern
  proposal_id: string | null // link back to originating proposal (Migration 003)
  tech_notes: string | null
  photos: string[] // storage URLs
  ai_report_content: Record<string, unknown> | null
  ai_invoice_content: Record<string, unknown> | null
  report_pdf_url: string | null
  invoice_pdf_url: string | null
  approved_by: string | null
  approved_at: string | null
  sent_at: string | null
  rejection_notes: string | null
  revision_request: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null // soft delete for archiving
}

export interface JobLineItem {
  id: string
  job_id: string
  service_catalog_id: string
  description: string | null
  quantity: number
  unit_price: number
  total_price: number
  notes: string | null
  created_at: string
}

// ============================================================
// Invoices
// ============================================================

export interface Invoice {
  id: string
  job_id: string
  organization_id: string
  client_id: string
  invoice_number: string
  amount: number
  tax_rate: number // percentage, e.g. 8.875 for NYC
  tax_amount: number
  total_amount: number
  status: InvoiceStatus
  due_date: string
  paid_date: string | null
  paid_amount: number
  payment_method: PaymentMethod | null
  notes: string | null
  // Stripe Connect (Migration 004) — set when invoice is paid via Stripe Checkout
  stripe_payment_intent_id: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_link_url: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Bank Transactions (for payment matching)
// ============================================================

export interface BankTransaction {
  id: string
  organization_id: string
  upload_batch_id: string
  transaction_date: string
  description: string
  amount: number
  matched_invoice_id: string | null
  match_confidence: number | null
  match_status: MatchStatus
  raw_data: Record<string, unknown>
  created_at: string
}

// ============================================================
// Activity Log
// ============================================================

// ============================================================
// Crews (Business tier — multi-crew management)
// ============================================================

export interface Crew {
  id: string
  organization_id: string
  name: string
  color: string // hex color for calendar UI
  lead_tech_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CrewMember {
  id: string
  crew_id: string
  user_id: string
  joined_at: string
}

// ============================================================
// Recurring Job Schedules (Business tier)
// ============================================================

export interface RecurringJobSchedule {
  id: string
  organization_id: string
  client_id: string
  site_id: string
  assigned_to: string | null // individual tech
  crew_id: string | null // or crew
  created_by: string
  // Pattern
  frequency: RecurringFrequency
  day_of_week: number[] // 0=Sun..6=Sat
  day_of_month: number | null
  scheduled_time: string // TIME as string "HH:MM:SS"
  estimated_duration_minutes: number
  service_ids: string[] // service_catalog IDs
  // Auto-creation
  advance_creation_days: number
  next_occurrence_date: string
  // State
  is_active: boolean
  paused_until: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// Activity Log
// ============================================================

// ============================================================
// Proposals / Estimates (Migration 003)
// ============================================================

export type ProposalStatus =
  | 'draft'
  | 'pending_admin_approval'
  | 'admin_approved'
  | 'sent_to_client'
  | 'client_approved'
  | 'client_rejected'
  | 'converted_to_job'
  | 'expired'
  | 'cancelled'

export type SignatureType = 'drawn' | 'typed'

export interface ProposalMaterial {
  name: string
  qty: number
  cost: number
}

export interface Proposal {
  id: string
  organization_id: string
  client_id: string
  site_id: string | null
  created_by: string
  assigned_to: string | null
  proposal_number: string
  status: ProposalStatus
  // Internal fields (not visible to client)
  measurements: string | null
  material_list: ProposalMaterial[]
  material_cost_total: number
  estimated_hours: number | null
  num_techs_needed: number
  estimated_days: number
  equipment_list: string[]
  internal_notes: string | null
  // Client-facing fields
  issue_description: string
  proposed_solution: string
  subtotal: number
  discount_enabled: boolean
  discount_amount: number
  discount_reason: string | null
  tax_rate: number
  tax_amount: number
  total_amount: number
  // Workflow timestamps
  submitted_for_approval_at: string | null
  admin_approved_at: string | null
  admin_approved_by: string | null
  sent_to_client_at: string | null
  sent_to_client_by: string | null
  client_approved_at: string | null
  client_rejected_at: string | null
  client_rejection_reason: string | null
  converted_to_job_id: string | null
  converted_at: string | null
  // Public sign URL token
  public_token: string | null
  valid_until: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface ProposalLineItem {
  id: string
  proposal_id: string
  service_catalog_id: string | null
  service_name: string
  description: string | null
  quantity: number
  unit: string
  unit_price: number
  total: number
  sort_order: number
  created_at: string
}

export interface ProposalSignature {
  id: string
  proposal_id: string
  signed_at: string
  signed_by_name: string
  signed_by_email: string
  signed_by_title: string | null
  signature_data: string | null
  signature_type: SignatureType
  ip_address: string | null
  user_agent: string | null
}

export type ActivityAction =
  // Job lifecycle
  | 'job_created'
  | 'job_submitted'
  | 'job_scheduled'
  | 'job_rescheduled'
  | 'job_assigned'
  | 'job_started'         // tech tapped "Start Job" (arrival logged)
  | 'job_ai_generating'
  | 'job_ai_completed'
  | 'job_approved'
  | 'job_rejected'
  | 'job_completed'
  | 'job_cancelled'
  | 'job_sent'            // report + invoice sent to client
  | 'job_deleted'
  | 'revision_requested'
  | 'report_manually_edited'
  | 'invoice_manually_edited'
  | 'report_regenerated'
  // Invoice
  | 'invoice_created'
  | 'invoice_sent'
  | 'invoice_paid'
  | 'invoice_marked_paid'        // manually marked paid (check/wire/cash/etc.)
  | 'invoice_paid_via_stripe'    // automatic via Stripe Connect webhook
  | 'invoice_voided'
  | 'payment_recorded'
  // CRM
  | 'client_created'
  | 'client_updated'
  | 'site_created'
  | 'user_invited'
  // Scheduling (Business tier)
  | 'crew_created'
  | 'crew_updated'
  | 'recurring_schedule_created'
  // Proposals (Migration 003)
  | 'proposal_created'
  | 'proposal_submitted_for_approval'
  | 'proposal_admin_approved'
  | 'proposal_sent_to_client'
  | 'proposal_signed_by_client'
  | 'proposal_rejected_by_client'
  | 'proposal_converted_to_job'

export interface ActivityLogEntry {
  id: string
  organization_id: string
  user_id: string
  action: ActivityAction
  entity_type: 'job' | 'invoice' | 'client' | 'site' | 'user' | 'proposal'
  entity_id: string
  metadata: Record<string, unknown> | null
  created_at: string
}
