'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, hasAnyPermission, type Permission } from '@/lib/permissions'
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Building2,
  Wrench,
  FileText,
  DollarSign,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  permission?: Parameters<typeof hasPermission>[1]
  anyPermission?: Permission[] // show if user has ANY of these
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Jobs', href: '/jobs', icon: ClipboardList, permission: 'jobs:view_own' },
  { label: 'Clients', href: '/clients', icon: Building2, permission: 'clients:view' },
  { label: 'Services', href: '/services', icon: Wrench, permission: 'services:view' },
  { label: 'Invoices', href: '/invoices', icon: FileText, anyPermission: ['invoices:view_all', 'invoices:view_own'] },
  { label: 'Finances', href: '/finances', icon: DollarSign, anyPermission: ['financials:view', 'financials:view_limited'] },
  { label: 'Team', href: '/team', icon: Users, permission: 'users:view' },
  { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings:view' },
]

export function AppSidebar({ mobileOpen, onMobileClose }: { mobileOpen?: boolean; onMobileClose?: () => void }) {
  const pathname = usePathname()
  const { user, organization } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  // Filter nav items by user permissions
  const visibleItems = navItems.filter((item) => {
    if (!item.permission && !item.anyPermission) return true
    if (!user) return false
    if (item.anyPermission) return hasAnyPermission(user.role, item.anyPermission)
    if (item.permission) return hasPermission(user.role, item.permission)
    return false
  })

  // Close mobile menu on route change
  useEffect(() => {
    if (mobileOpen && onMobileClose) {
      onMobileClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          // Desktop: static sidebar
          'hidden md:relative md:flex flex-col border-r transition-all duration-200',
          collapsed ? 'md:w-16' : 'md:w-64',
          // Mobile: slide-in drawer
          mobileOpen && 'fixed inset-y-0 left-0 z-50 flex w-72 md:relative md:w-64',
          !mobileOpen && 'md:flex'
        )}
        style={{
          backgroundColor: 'var(--brand-primary, #05093d)',
          borderColor: 'var(--brand-primary, #05093d)',
        }}
      >
        {/* Logo / Org Name */}
        <div className="flex h-16 items-center px-4 border-b border-white/10 justify-between">
          <div className="flex items-center min-w-0">
            {organization?.logo_url ? (
              <Image
                src={organization.logo_url}
                alt={organization?.name || 'Organization'}
                width={120}
                height={32}
                className={cn('h-8 w-auto object-contain', collapsed && !mobileOpen ? 'mx-auto' : '')}
              />
            ) : (
              <>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold text-sm"
                  style={{
                    backgroundColor: 'var(--brand-accent, #00ff85)',
                    color: 'var(--brand-btn-fg, #0a0a0a)',
                  }}
                >
                  {organization?.name?.charAt(0) || 'P'}
                </div>
                {(!collapsed || mobileOpen) && (
                  <span className="ml-3 font-semibold text-white truncate">
                    {organization?.name || 'Pipeline AI'}
                  </span>
                )}
              </>
            )}
          </div>
          {/* Mobile close button */}
          {mobileOpen && (
            <button
              onClick={onMobileClose}
              className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            const Icon = item.icon
            const isCollapsedDesktop = collapsed && !mobileOpen

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isCollapsedDesktop && 'justify-center px-2',
                  isActive
                    ? 'text-[var(--brand-btn-fg,#0a0a0a)] font-medium'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                )}
                style={
                  isActive
                    ? { backgroundColor: 'var(--brand-accent, #00ff85)' }
                    : undefined
                }
                title={isCollapsedDesktop ? item.label : undefined}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!isCollapsedDesktop && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Collapse Toggle — desktop only */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex absolute -right-3 top-20 h-6 w-6 items-center justify-center rounded-full border bg-white shadow-sm hover:bg-zinc-50 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5 text-zinc-600" />
          )}
        </button>

        {/* User info at bottom */}
        <div className="border-t border-white/10 p-3">
          <div className={cn('flex items-center gap-3', collapsed && !mobileOpen && 'justify-center')}>
            <div className="h-8 w-8 shrink-0 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-medium">
              {user?.full_name?.charAt(0) || '?'}
            </div>
            {(!collapsed || mobileOpen) && (
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
    </>
  )
}
