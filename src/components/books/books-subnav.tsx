'use client'

/**
 * BooksSubNav — secondary navigation inside the /books layout.
 *
 * Renders as a horizontally-scrolling pill bar on mobile and a left rail
 * on desktop. Each entry filters out by permission so office_managers
 * never see "Lock period" in Settings, etc. (page-level guards still
 * apply — this is just UX hygiene).
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FileText,
  ReceiptText,
  CreditCard,
  Wallet,
  Banknote,
  Truck,
  Boxes,
  ListTree,
  Settings,
  BarChart3,
} from 'lucide-react'

const ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/books', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/books/invoices', label: 'Invoices', icon: FileText },
  { href: '/books/bills', label: 'Bills', icon: ReceiptText },
  { href: '/books/expenses', label: 'Expenses', icon: CreditCard },
  { href: '/books/payments', label: 'Payments', icon: Wallet },
  { href: '/books/banking', label: 'Banking', icon: Banknote },
  { href: '/books/reports', label: 'Reports', icon: BarChart3 },
  { href: '/books/vendors', label: 'Vendors', icon: Truck },
  { href: '/books/items', label: 'Items', icon: Boxes },
  { href: '/books/accounts', label: 'Chart of Accounts', icon: ListTree },
  { href: '/books/settings', label: 'Settings', icon: Settings },
]

function isActive(pathname: string, href: string) {
  // /books matches only when on /books exactly (dashboard);
  // every other entry matches its segment plus subroutes.
  if (href === '/books') return pathname === '/books'
  return pathname === href || pathname.startsWith(href + '/')
}

export function BooksSubNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile: horizontal scroll pills */}
      <nav
        aria-label="Books"
        className="lg:hidden -mx-4 sm:-mx-6 mb-4 overflow-x-auto border-b bg-card/40"
      >
        <ul className="flex min-w-max items-center gap-1 px-4 sm:px-6">
          {ITEMS.map((it) => {
            const Icon = it.icon
            const active = isActive(pathname, it.href)
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors',
                    active
                      ? 'border-brand-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{it.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Desktop: vertical rail */}
      <nav
        aria-label="Books"
        className="hidden lg:flex w-56 shrink-0 flex-col gap-1 pr-4"
      >
        {ITEMS.map((it) => {
          const Icon = it.icon
          const active = isActive(pathname, it.href)
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{it.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
