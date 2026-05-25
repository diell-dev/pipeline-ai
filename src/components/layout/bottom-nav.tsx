'use client'

/**
 * Mobile Bottom Nav
 *
 * Replaces the sidebar drawer on phones (<md). Five thumb-reachable slots:
 *   - Field Tech:   Dashboard, My Schedule, Jobs, Menu
 *   - Manager+:     Dashboard, Jobs, Schedule, Equipment, Menu
 *
 * "Menu" opens a bottom sheet listing the rest of the nav items so nothing
 * is hidden — just deprioritized. Active item gets a brand-primary top
 * border + brand-primary icon/text.
 *
 * Rendered only at <md. The sidebar renders at md+.
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, hasAnyPermission, type Permission } from '@/lib/permissions'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  LayoutDashboard,
  ClipboardList,
  Calendar,
  QrCode,
  MoreHorizontal,
  Building2,
  Wrench,
  FileText,
  FileSignature,
  DollarSign,
  Users,
  Settings,
  FlaskConical,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  permission?: Permission
  anyPermission?: Permission[]
  techOnly?: boolean
  managersOnly?: boolean
}

// Same shape as the sidebar's navItems — duplicated here so the two stay
// independent (different ordering / grouping on mobile vs desktop).
const ALL_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Proposals', href: '/proposals', icon: FileSignature, permission: 'proposals:view_own' },
  { label: 'Jobs', href: '/jobs', icon: ClipboardList, permission: 'jobs:view_own' },
  { label: 'Schedule', href: '/schedule', icon: Calendar, permission: 'jobs:schedule', managersOnly: true },
  { label: 'My Schedule', href: '/schedule/my-schedule', icon: Calendar, techOnly: true },
  { label: 'Equipment', href: '/equipment', icon: QrCode, permission: 'equipment:view' as Permission },
  { label: 'Clients', href: '/clients', icon: Building2, permission: 'clients:view' },
  { label: 'Services', href: '/services', icon: Wrench, permission: 'services:view' },
  { label: 'Invoices', href: '/invoices', icon: FileText, anyPermission: ['invoices:view_all', 'invoices:view_own'] },
  { label: 'Finances', href: '/finances', icon: DollarSign, anyPermission: ['financials:view', 'financials:view_limited'] },
  { label: 'Team', href: '/team', icon: Users, permission: 'users:view' },
  { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings:view' },
  { label: 'AI Sandbox', href: '/test-ai', icon: FlaskConical, permission: 'settings:system' },
]

// Primary slots shown directly in the bottom nav (max 4 — slot 5 is "More").
// Order is intentional: most-used first, since slot 1 is leftmost/thumb-friendly.
const PRIMARY_FOR_MANAGER = ['/dashboard', '/jobs', '/schedule', '/equipment'] as const
const PRIMARY_FOR_TECH = ['/dashboard', '/schedule/my-schedule', '/jobs'] as const

export function BottomNav() {
  const pathname = usePathname()
  const { user } = useAuthStore()
  const [moreOpen, setMoreOpen] = useState(false)

  if (!user) return null

  const isManager = hasPermission(user.role, 'jobs:schedule')

  // Filter ALL_ITEMS by user permissions
  const visibleItems = ALL_ITEMS.filter((item) => {
    if (item.managersOnly && !isManager) return false
    if (item.techOnly && isManager) return false
    if (!item.permission && !item.anyPermission) return true
    if (item.anyPermission) return hasAnyPermission(user.role, item.anyPermission)
    if (item.permission) return hasPermission(user.role, item.permission)
    return false
  })

  // Resolve the primary slots in order
  const primaryHrefs = isManager ? PRIMARY_FOR_MANAGER : PRIMARY_FOR_TECH
  const primaryItems = primaryHrefs
    .map((href) => visibleItems.find((it) => it.href === href))
    .filter((it): it is NavItem => Boolean(it))

  // Everything that wasn't promoted to a primary slot goes into the Menu sheet
  const overflowItems = visibleItems.filter(
    (it) => !primaryItems.some((p) => p.href === it.href)
  )

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href + '/'))

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid h-16 grid-cols-5">
        {primaryItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                active ? 'text-brand-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {/* Active top border */}
              {active && (
                <span className="bg-brand-primary absolute inset-x-3 top-0 h-0.5 rounded-b" />
              )}
              <Icon className="h-5 w-5" />
              <span className="truncate px-1">{item.label}</span>
            </Link>
          )
        })}

        {/* Menu — sheet trigger (formerly "More"; see UX-SWEEP-#22) */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            className={cn(
              'relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
              overflowItems.some((it) => isActive(it.href))
                ? 'text-brand-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {overflowItems.some((it) => isActive(it.href)) && (
              <span className="bg-brand-primary absolute inset-x-3 top-0 h-0.5 rounded-b" />
            )}
            <MoreHorizontal className="h-5 w-5" />
            {/* UX-SWEEP-#22: was "More" — too vague. "Menu" matches the sheet title
                and tells users they'll see the rest of the app's navigation. */}
            <span>Menu</span>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
          >
            <SheetHeader className="text-left">
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {overflowItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 rounded-xl border p-4 text-xs font-medium transition-colors',
                      active
                        ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                        : 'border-border text-foreground hover:bg-muted'
                    )}
                  >
                    <Icon className="h-6 w-6" />
                    <span className="text-center leading-tight">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  )
}
