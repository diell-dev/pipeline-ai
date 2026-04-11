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

export type JobStatus =
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
  arrival_time: string | null // when tech arrived on site
  completion_time: string | null // when job was finished
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
  quantity: number
  unit_price: number
  total_price: number
  notes: string | null
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

export type ActivityAction =
  | 'job_submitted'
  | 'job_approved'
  | 'job_rejected'
  | 'job_completed'
  | 'job_cancelled'
  | 'invoice_sent'
  | 'invoice_paid'
  | 'payment_recorded'
  | 'client_created'
  | 'client_updated'
  | 'site_created'
  | 'user_invited'
  | 'revision_requested'

export interface ActivityLogEntry {
  id: string
  organization_id: string
  user_id: string
  action: ActivityAction
  entity_type: 'job' | 'invoice' | 'client' | 'site' | 'user'
  entity_id: string
  metadata: Record<string, unknown> | null
  created_at: string
}
