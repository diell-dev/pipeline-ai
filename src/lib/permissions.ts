/**
 * Pipeline AI — Role-Based Permission System
 *
 * Defines what each role can do. Checked both client-side (to hide UI elements)
 * and server-side (to enforce security). Never trust client-side checks alone.
 */
import type { UserRole } from '@/types/database'

// ============================================================
// Permission Definitions
// ============================================================

export type Permission =
  // Jobs
  | 'jobs:create'
  | 'jobs:view_own'
  | 'jobs:view_all'
  | 'jobs:edit_own'
  | 'jobs:edit_all'
  | 'jobs:approve'
  | 'jobs:reject'
  | 'jobs:send'
  | 'jobs:delete' // owner only
  | 'jobs:schedule' // managers+ — calendar scheduling
  // Scheduling (crews + recurring patterns)
  | 'crews:manage' // managers+
  | 'recurring:manage' // managers+
  // Proposals / Estimates
  | 'proposals:create'
  | 'proposals:view_own'
  | 'proposals:view_all'
  | 'proposals:approve' // admin approval before sending to client
  | 'proposals:send'
  | 'proposals:delete'
  | 'proposals:convert' // manually convert client_approved → job
  // Clients
  | 'clients:view'
  | 'clients:create'
  | 'clients:edit'
  | 'clients:delete'
  // Sites
  | 'sites:view'
  | 'sites:create'
  | 'sites:edit'
  // Services
  | 'services:view'
  | 'services:manage'
  // Pricing
  | 'pricing:view'
  | 'pricing:manage'
  // Invoices
  | 'invoices:view_own'
  | 'invoices:view_all'
  | 'invoices:mark_paid'
  | 'invoices:delete' // owner only
  // Financials
  | 'financials:view'
  | 'financials:view_limited'
  | 'financials:manage'
  | 'financials:upload_bank'
  // Users
  | 'users:view'
  | 'users:manage'
  | 'users:invite'
  // Settings
  | 'settings:view'
  | 'settings:manage'
  | 'settings:system' // super admin only
  // Reports/Documents
  | 'documents:view_own'
  | 'documents:view_all'
  | 'documents:request_revision' // client portal

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    // Super admin can do everything
    'jobs:create', 'jobs:view_own', 'jobs:view_all', 'jobs:edit_own', 'jobs:edit_all',
    'jobs:approve', 'jobs:reject', 'jobs:send', 'jobs:delete', 'jobs:schedule',
    'crews:manage', 'recurring:manage',
    'proposals:create', 'proposals:view_own', 'proposals:view_all',
    'proposals:approve', 'proposals:send', 'proposals:delete', 'proposals:convert',
    'clients:view', 'clients:create', 'clients:edit', 'clients:delete',
    'sites:view', 'sites:create', 'sites:edit',
    'services:view', 'services:manage',
    'pricing:view', 'pricing:manage',
    'invoices:view_own', 'invoices:view_all', 'invoices:mark_paid', 'invoices:delete',
    'financials:view', 'financials:manage', 'financials:upload_bank',
    'users:view', 'users:manage', 'users:invite',
    'settings:view', 'settings:manage', 'settings:system',
    'documents:view_own', 'documents:view_all',
  ],

  owner: [
    'jobs:create', 'jobs:view_own', 'jobs:view_all', 'jobs:edit_own', 'jobs:edit_all',
    'jobs:approve', 'jobs:reject', 'jobs:send', 'jobs:delete', 'jobs:schedule',
    'crews:manage', 'recurring:manage',
    'proposals:create', 'proposals:view_own', 'proposals:view_all',
    'proposals:approve', 'proposals:send', 'proposals:delete', 'proposals:convert',
    'clients:view', 'clients:create', 'clients:edit', 'clients:delete',
    'sites:view', 'sites:create', 'sites:edit',
    'services:view', 'services:manage',
    'pricing:view', 'pricing:manage',
    'invoices:view_own', 'invoices:view_all', 'invoices:mark_paid', 'invoices:delete',
    'financials:view', 'financials:manage', 'financials:upload_bank',
    'users:view', 'users:manage', 'users:invite',
    'settings:view', 'settings:manage',
    'documents:view_own', 'documents:view_all',
  ],

  office_manager: [
    'jobs:create', 'jobs:view_own', 'jobs:view_all', 'jobs:edit_own', 'jobs:edit_all',
    'jobs:approve', 'jobs:reject', 'jobs:send', 'jobs:schedule',
    'crews:manage', 'recurring:manage',
    'proposals:create', 'proposals:view_own', 'proposals:view_all',
    'proposals:approve', 'proposals:send', 'proposals:convert',
    'clients:view', 'clients:create', 'clients:edit',
    'sites:view', 'sites:create', 'sites:edit',
    'services:view',
    'pricing:view',
    'invoices:view_own', 'invoices:view_all', 'invoices:mark_paid',
    'financials:view_limited',
    'users:view',
    'settings:view',
    'documents:view_own', 'documents:view_all',
  ],

  field_tech: [
    'jobs:create', 'jobs:view_own', 'jobs:edit_own',
    'proposals:create', 'proposals:view_own',
    'clients:view', 'clients:create', // can add new clients in the field
    'sites:view', 'sites:create', // can add new sites in the field
    'services:view',
    'documents:view_own',
  ],

  client: [
    'invoices:view_own',
    'documents:view_own',
    'documents:request_revision',
  ],
}

// ============================================================
// Permission Checker Functions
// ============================================================

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * Check if a role has ALL of the specified permissions
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p))
}

/**
 * Check if a role has ANY of the specified permissions
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p))
}

/**
 * Get all permissions for a role
 */
export function getPermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] || []
}

/**
 * Get a human-readable role label
 */
export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    super_admin: 'Super Admin',
    owner: 'Owner',
    office_manager: 'Office Manager',
    field_tech: 'Field Technician',
    client: 'Client',
  }
  return labels[role] || role
}

/**
 * Check if a role can manage another role (for invitation/role assignment)
 */
export function canManageRole(managerRole: UserRole, targetRole: UserRole): boolean {
  const hierarchy: Record<UserRole, number> = {
    super_admin: 5,
    owner: 4,
    office_manager: 3,
    field_tech: 2,
    client: 1,
  }
  return hierarchy[managerRole] > hierarchy[targetRole]
}
