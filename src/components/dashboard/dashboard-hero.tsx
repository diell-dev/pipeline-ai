'use client'

/**
 * DashboardHero — Phase D
 *
 * Replaces the generic "Welcome back, X / Role · email" header with a
 * time-of-day greeting, today's date, and 2–3 next-best-action chips
 * routed to the most-actionable workflow filters.
 *
 * Layout:
 *   ─────────────────────────────────────────────────────
 *   Good morning, Diell
 *   Monday, May 25
 *
 *   [3 jobs pending review →]  [1 invoice overdue →]  [2 equipment due]
 *   ─────────────────────────────────────────────────────
 *
 * Action chips are clickable links into the filtered list pages — clicking
 * "3 jobs pending review" routes to /jobs?filter=pending_review etc.
 *
 * When all action counts are zero, the chip row collapses to a single
 * friendly "All clear — nothing urgent" success state so the hero never
 * feels empty.
 *
 * On mobile (`<sm`), only the single most-urgent chip is rendered inline.
 * The remaining chips collapse behind a "+N more" affordance that expands
 * inline. Desktop always shows the full row.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export interface DashboardActionInput {
  /** Number of items needing attention. 0 hides this action. */
  count: number
  /** Total noun, e.g. "job". The component pluralises automatically. */
  noun: string
  /** Trailing verb / context, e.g. "pending review" or "overdue". */
  context: string
  href: string
  icon: LucideIcon
  /** Tone for the chip. Defaults to "warning". */
  tone?: 'warning' | 'danger' | 'info' | 'success'
}

interface DashboardHeroProps {
  /** First name to greet. Defaults to "there". */
  firstName?: string | null
  /** Action chips, in priority order — highest-impact first. */
  actions: DashboardActionInput[]
  /** Optional right-rail actions (e.g. "New Job" button). */
  rightActions?: React.ReactNode
  /** When true, hide the greeting subtitle (useful on very small screens). */
  compactSubtitle?: boolean
  className?: string
}

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatTodayDate(now: Date): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

const TONE_CLASSES: Record<NonNullable<DashboardActionInput['tone']>, string> = {
  warning:
    'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20',
  danger:
    'border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20',
  info:
    'border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200 dark:hover:bg-blue-500/20',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20',
}

function ActionChip({ action }: { action: DashboardActionInput }) {
  const Icon = action.icon
  const tone = action.tone ?? 'warning'
  const noun = action.count === 1 ? action.noun : `${action.noun}s`
  return (
    <Link
      href={action.href}
      className={cn(
        'group inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        TONE_CLASSES[tone]
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        <span className="font-semibold">{action.count}</span> {noun} {action.context}
      </span>
      <ArrowRight className="h-3 w-3 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

export function DashboardHero({
  firstName,
  actions,
  rightActions,
  compactSubtitle,
  className,
}: DashboardHeroProps) {
  // Server-rendered now/locale: stable for the request lifetime. Browser
  // timezone is fine — the existing app doesn't track per-org TZ.
  const now = useMemo(() => new Date(), [])
  const hello = greeting(now)
  const todayLabel = formatTodayDate(now)

  // Filter out zero-count actions and sort by count descending so the
  // most-urgent chip is always first.
  const urgent = useMemo(
    () =>
      actions
        .filter((a) => a.count > 0)
        .sort((a, b) => {
          // danger > warning > info > success when counts tie
          const ranks: Record<NonNullable<DashboardActionInput['tone']>, number> = {
            danger: 4,
            warning: 3,
            info: 2,
            success: 1,
          }
          const ra = ranks[a.tone ?? 'warning']
          const rb = ranks[b.tone ?? 'warning']
          if (rb !== ra) return rb - ra
          return b.count - a.count
        }),
    [actions]
  )

  const [mobileExpanded, setMobileExpanded] = useState(false)

  const allClear = urgent.length === 0

  return (
    <header className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="font-heading text-2xl font-bold tracking-tight leading-tight sm:text-3xl">
            {hello}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          {!compactSubtitle && (
            <p className="text-sm text-muted-foreground">{todayLabel}</p>
          )}
        </div>
        {rightActions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {rightActions}
          </div>
        )}
      </div>

      {allClear ? (
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          All clear — nothing urgent today.
        </div>
      ) : (
        <>
          {/* Mobile: 1 chip + "more" expander */}
          <div className="flex flex-wrap items-center gap-2 sm:hidden">
            <ActionChip action={urgent[0]} />
            {urgent.length > 1 && !mobileExpanded && (
              <button
                type="button"
                onClick={() => setMobileExpanded(true)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                +{urgent.length - 1} more
              </button>
            )}
            {mobileExpanded &&
              urgent.slice(1).map((a, i) => <ActionChip key={i} action={a} />)}
          </div>

          {/* Desktop: full row */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {urgent.map((a, i) => (
              <ActionChip key={i} action={a} />
            ))}
          </div>
        </>
      )}
    </header>
  )
}

/**
 * Re-export common icons so the dashboard page can build the
 * `actions` array without re-importing lucide individually.
 */
export const DASHBOARD_ACTION_ICONS = {
  pendingReview: ClipboardList,
  invoiceOverdue: DollarSign,
  equipmentDueSoon: Wrench,
  generic: AlertTriangle,
} satisfies Record<string, LucideIcon>
