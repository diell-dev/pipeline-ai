'use client'

/**
 * Client-portal navigation. Bottom tab bar on mobile (thumb zone), a
 * horizontal tab strip on desktop. Four tabs, large tap targets.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Wrench, ReceiptText, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/portal', label: 'Home', icon: Home, exact: true },
  { href: '/portal/service', label: 'Service', icon: Wrench, exact: false },
  { href: '/portal/invoices', label: 'Invoices', icon: ReceiptText, exact: false },
  { href: '/portal/visits', label: 'Visits', icon: CalendarClock, exact: false },
] as const

function isActive(pathname: string, href: string, exact: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
}

export function PortalTabs() {
  const pathname = usePathname()
  return (
    <nav className="hidden md:flex gap-1">
      {TABS.map(({ href, label, icon: Icon, exact }) => {
        const active = isActive(pathname, href, exact)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-brand-primary/10 text-brand-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        )
      })}
    </nav>
  )
}

export function PortalBottomNav() {
  const pathname = usePathname()
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/90 backdrop-blur md:hidden dark:bg-zinc-900/90"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-3xl">
        {TABS.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(pathname, href, exact)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
                active ? 'text-brand-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5 transition-transform', active && 'scale-110')} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
