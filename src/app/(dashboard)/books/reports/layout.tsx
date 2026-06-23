'use client'

/**
 * Books → Reports — section layout
 *
 * Adds a left sub-nav so users can jump between report types without
 * dropping back to the index page. The wrapper itself does NOT enforce
 * tier / permission gating — each report page does that itself so
 * deep-links land cleanly in /upgrade when needed.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardList,
  FileText,
  Landmark,
  Receipt,
  ScrollText,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface ReportLink {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const REPORT_LINKS: ReportLink[] = [
  { label: 'All Reports', href: '/books/reports', icon: ClipboardList },
  { label: 'Profit & Loss', href: '/books/reports/profit-loss', icon: TrendingUp },
  { label: 'Balance Sheet', href: '/books/reports/balance-sheet', icon: BookOpen },
  { label: 'Cash Flow', href: '/books/reports/cash-flow', icon: Wallet },
  { label: 'AR Aging', href: '/books/reports/ar-aging', icon: Receipt },
  { label: 'AP Aging', href: '/books/reports/ap-aging', icon: FileText },
  { label: 'Trial Balance', href: '/books/reports/trial-balance', icon: Calculator },
  { label: 'General Ledger', href: '/books/reports/general-ledger', icon: ScrollText },
  { label: 'Sales Tax', href: '/books/reports/sales-tax', icon: Landmark },
]

export default function BooksReportsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Left sub-nav: hidden on mobile (collapses into a horizontal pill
              strip), shows as a vertical list on desktop. */}
          <aside
            className="lg:w-56 lg:shrink-0 lg:sticky lg:top-4 print:hidden"
            aria-label="Reports navigation"
          >
            {/* Horizontal scroll on mobile, vertical stack on desktop. */}
            <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              <div className="hidden px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:block">
                <BarChart3 className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
                Reports
              </div>
              {REPORT_LINKS.map((link) => {
                const active =
                  link.href === '/books/reports'
                    ? pathname === '/books/reports'
                    : pathname?.startsWith(link.href)
                const Icon = link.icon
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'group flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-[background,color] duration-100',
                      active
                        ? 'bg-accent text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active ? 'text-foreground' : 'text-muted-foreground/70'
                      )}
                      aria-hidden="true"
                    />
                    <span>{link.label}</span>
                  </Link>
                )
              })}
            </nav>
          </aside>

          {/* Right content area */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>

      {/* Print stylesheet shared across every report page. Keeps the
          screen UI untouched but makes the printout something a CFO
          would actually staple to a folder. */}
      <style jsx global>{`
        @media print {
          /* Hide app chrome — sidebar, headers, footers — when the user
             prints from a report page. */
          [data-slot='app-sidebar'],
          [data-slot='app-header'],
          [data-slot='bottom-nav'],
          .print\\:hidden {
            display: none !important;
          }

          /* Drop background colors so the printer doesn't burn ink on
             the muted-zinc backgrounds. */
          body,
          html,
          main {
            background: #ffffff !important;
            color: #000000 !important;
          }

          /* Re-flow the main area so it occupies the full sheet. */
          main {
            overflow: visible !important;
            padding: 0 !important;
          }

          /* Tables go edge-to-edge with minimal padding. */
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          thead {
            display: table-header-group;
          }

          /* Section headings start on a fresh page if there's no room. */
          h1, h2 {
            page-break-after: avoid;
          }

          /* Standard letter / A4 print margins. */
          @page {
            margin: 0.5in;
          }
        }
      `}</style>
    </div>
  )
}
