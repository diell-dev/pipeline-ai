'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, hasAnyPermission, type Permission } from '@/lib/permissions'
import { hasFeature } from '@/lib/tier-limits'
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Building2,
  Wrench,
  FileText,
  FileSignature,
  DollarSign,
  Settings,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Calendar,
  QrCode,
  BookOpen,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  permission?: Parameters<typeof hasPermission>[1]
  anyPermission?: Permission[] // show if user has ANY of these
  // If true, item is rendered for field techs only (no jobs:schedule perm)
  techOnly?: boolean
  // If true, item is rendered for managers only (has jobs:schedule perm)
  managersOnly?: boolean
  // If true, item is only shown when the org's tier includes `bookkeeping`.
  // B3 — added with the Books module.
  requiresBookkeeping?: boolean
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Proposals', href: '/proposals', icon: FileSignature, permission: 'proposals:view_own' },
  { label: 'Jobs', href: '/jobs', icon: ClipboardList, permission: 'jobs:view_own' },
  // Managers see the full Schedule (calendar); techs see "My Schedule"
  { label: 'Schedule', href: '/schedule', icon: Calendar, permission: 'jobs:schedule', managersOnly: true },
  { label: 'My Schedule', href: '/schedule/my-schedule', icon: Calendar, techOnly: true },
  // Equipment cataloging — gated by the new 'equipment:view' permission added by the backend agent.
  // Casting because the Permission union may not yet include the new keys when this file is type-checked.
  { label: 'Equipment', href: '/equipment', icon: QrCode, permission: 'equipment:view' as Parameters<typeof hasPermission>[1] },
  { label: 'Clients', href: '/clients', icon: Building2, permission: 'clients:view' },
  { label: 'Services', href: '/services', icon: Wrench, permission: 'services:view' },
  { label: 'Invoices', href: '/invoices', icon: FileText, anyPermission: ['invoices:view_all', 'invoices:view_own'] },
  { label: 'Finances', href: '/finances', icon: DollarSign, anyPermission: ['financials:view', 'financials:view_limited'] },
  // Books — Business-tier-only bookkeeping module. Gated on perm AND tier feature.
  { label: 'Books', href: '/books', icon: BookOpen, permission: 'bookkeeping:view', requiresBookkeeping: true },
  { label: 'Team', href: '/team', icon: Users, permission: 'users:view' },
  { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings:view' },
  { label: 'AI Sandbox', href: '/test-ai', icon: FlaskConical, permission: 'settings:system' },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { user, organization } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  // Filter nav items by user permissions
  const isManager = user?.role ? hasPermission(user.role, 'jobs:schedule') : false
  const hasBookkeeping = organization ? hasFeature(organization.tier, 'bookkeeping') : false
  const visibleItems = navItems.filter((item) => {
    if (item.managersOnly && !isManager) return false
    if (item.techOnly && (isManager || !user)) return false
    if (item.requiresBookkeeping && !hasBookkeeping) return false
    if (!item.permission && !item.anyPermission) return true
    if (!user) return false
    if (item.anyPermission) return hasAnyPermission(user.role, item.anyPermission)
    if (item.permission) return hasPermission(user.role, item.permission)
    return false
  })

  return (
    <aside
      className={cn(
        'bg-brand-primary border-brand-primary relative flex flex-col border-r transition-all duration-200',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo / Org Name */}
      <div className="flex h-16 items-center px-4 border-b border-white/10">
        {organization?.logo_url ? (
          <Image
            src={organization.logo_url}
            alt={organization?.name || 'Organization'}
            width={120}
            height={32}
            className={cn('h-8 w-auto object-contain', collapsed ? 'mx-auto' : '')}
          />
        ) : (
          <>
            <div
              className="bg-brand-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold text-sm"
            >
              {organization?.name?.charAt(0) || 'P'}
            </div>
            {!collapsed && (
              <span className="ml-3 font-semibold text-white truncate">
                {organization?.name || 'Pipeline AI'}
              </span>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'bg-brand-accent font-medium'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border bg-card shadow-sm hover:bg-muted transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* User info at bottom */}
      <div className="border-t border-white/10 p-3">
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <div className="h-8 w-8 shrink-0 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-medium">
            {user?.full_name?.charAt(0) || '?'}
          </div>
          {!collapsed && (
            <div className="truncate">
              <p className="text-sm font-medium text-white truncate">
                {user?.full_name}
              </p>
              <p className="text-xs text-white/50 truncate">{user?.email}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
