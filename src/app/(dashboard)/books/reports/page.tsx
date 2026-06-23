'use client'

/**
 * Books → Reports — index page.
 *
 * Grid of cards, one per report. Each card explains in plain language
 * what the report shows. Tier + permission gating happens via
 * ReportPageGuard so deep-links land cleanly.
 */
import Link from 'next/link'
import {
  BookOpen,
  Calculator,
  FileText,
  Landmark,
  Receipt,
  ScrollText,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'

import { ReportPageGuard } from './_components/report-page-guard'

interface ReportCardSpec {
  href: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const REPORTS: ReportCardSpec[] = [
  {
    href: '/books/reports/profit-loss',
    title: 'Profit & Loss',
    description:
      'Revenue, cost of goods sold, gross profit, operating expenses, and net income for a chosen period.',
    icon: TrendingUp,
  },
  {
    href: '/books/reports/balance-sheet',
    title: 'Balance Sheet',
    description:
      'Snapshot of what the business owns, owes, and is worth — assets, liabilities, and equity as of a date.',
    icon: BookOpen,
  },
  {
    href: '/books/reports/cash-flow',
    title: 'Cash Flow',
    description:
      'How net income translates to cash, with working-capital adjustments for AR, AP, and depreciation.',
    icon: Wallet,
  },
  {
    href: '/books/reports/ar-aging',
    title: 'AR Aging',
    description:
      'Outstanding customer invoices bucketed by how long they have been past due — current, 1-30, 31-60, 61-90, 90+.',
    icon: Receipt,
  },
  {
    href: '/books/reports/ap-aging',
    title: 'AP Aging',
    description:
      'Outstanding vendor bills bucketed by how long they have been past due, so you know who to pay first.',
    icon: FileText,
  },
  {
    href: '/books/reports/trial-balance',
    title: 'Trial Balance',
    description:
      'Every account with its total debits and credits — proves the books balance before closing the period.',
    icon: Calculator,
  },
  {
    href: '/books/reports/general-ledger',
    title: 'General Ledger',
    description:
      'Drill into every posted journal entry with running balances. Filter by account for an account history.',
    icon: ScrollText,
  },
  {
    href: '/books/reports/sales-tax',
    title: 'Sales Tax Summary',
    description:
      'Per-rate breakdown of tax collected vs paid, so filing the return is a copy-paste.',
    icon: Landmark,
  },
]

export default function BooksReportsIndexPage() {
  return (
    <ReportPageGuard>
      <div className="space-y-6">
        <PageHeader
          breadcrumb={[
            { label: 'Books', href: '/books' },
            { label: 'Reports' },
          ]}
          title="Financial Reports"
          subtitle="GAAP-style statements computed from your journal entries — pick a report to drill in."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {REPORTS.map((r) => {
            const Icon = r.icon
            return (
              <Link
                key={r.href}
                href={r.href}
                className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-[box-shadow,transform] duration-150 ease-out-strong [@media(hover:hover)_and_(pointer:fine)]:group-hover:shadow-md motion-safe:group-active:scale-[0.995]">
                  <CardContent className="space-y-2 p-5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground/80 ring-1 ring-border">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <h3 className="font-heading text-base font-semibold tracking-tight text-foreground">
                      {r.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">{r.description}</p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </ReportPageGuard>
  )
}
