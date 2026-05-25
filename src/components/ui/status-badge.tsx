'use client'

/**
 * StatusBadge — UX-SWEEP-#24
 *
 * Centralized color mapping for the colored status pills that appear across
 * jobs, invoices, and proposals. The colors below are the SOURCE OF TRUTH
 * for status semantics; previously each page defined its own inline
 * className map (see jobs/page.tsx STATUS_CONFIG, invoices/page.tsx
 * STATUS_STYLES, etc.) and they drifted apart over time.
 *
 * Color semantics (apply across all status types):
 *   - zinc   → neutral / not yet started (draft, cancelled, void)
 *   - cyan   → scheduled / queued
 *   - blue   → in flight (submitted, sent to client, sent invoice)
 *   - purple → automated/AI processing
 *   - amber  → needs attention (pending review, partial payment)
 *   - orange → blocked / needs user action (revision requested)
 *   - indigo → revised, awaiting re-review
 *   - green  → approved / paid
 *   - emerald → completed / done
 *   - teal   → awaiting external action (sent, waiting on client)
 *   - red    → bad outcome (rejected, overdue)
 *
 * Usage:
 *   <StatusBadge status="paid" type="invoice" />
 *   <StatusBadge status="scheduled" type="job" />
 *
 * If a status isn't recognized for the given type, it falls back to neutral
 * styling and renders the raw value (useful while DB enums evolve).
 *
 * NOTE: this component is a pattern to migrate toward — existing pages
 * with inline STATUS_CONFIG maps are still working and shouldn't be
 * refactored en-masse without a focused pass. See jobs/page.tsx and
 * invoices/page.tsx for the legacy maps that should eventually be deleted
 * in favor of this wrapper.
 */
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type StatusType = 'job' | 'invoice' | 'proposal'

interface StatusStyle {
  label: string
  className: string
}

// Job statuses — mirrors JobStatus in types/database
// Phase G: every entry pairs the light tint with a dark variant so the
// light-100 backgrounds don't blow out against the zinc-950 page surface.
const JOB_STATUSES: Record<string, StatusStyle> = {
  scheduled:          { label: 'Scheduled',          className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
  submitted:          { label: 'Submitted',          className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  ai_generating:      { label: 'AI Processing',      className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  pending_review:     { label: 'Pending Review',     className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  approved:           { label: 'Approved',           className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  sent:               { label: 'Sent to Client',     className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  revision_requested: { label: 'Revision Requested', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  revised:            { label: 'Revised',            className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  rejected:           { label: 'Rejected',           className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  completed:          { label: 'Completed',          className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  cancelled:          { label: 'Cancelled',          className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
}

// Invoice statuses — mirrors InvoiceStatus in types/database
const INVOICE_STATUSES: Record<string, StatusStyle> = {
  draft:          { label: 'Draft',   className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  sent:           { label: 'Sent',    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  paid:           { label: 'Paid',    className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  partially_paid: { label: 'Partial', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  overdue:        { label: 'Overdue', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  void:           { label: 'Void',    className: 'bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-400' },
}

// Proposal statuses
const PROPOSAL_STATUSES: Record<string, StatusStyle> = {
  draft:        { label: 'Draft',        className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  sent:         { label: 'Sent',         className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  viewed:       { label: 'Viewed',       className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
  accepted:     { label: 'Accepted',     className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  signed:       { label: 'Signed',       className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rejected:     { label: 'Rejected',     className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  expired:      { label: 'Expired',      className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  cancelled:    { label: 'Cancelled',    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
}

const TYPE_MAP: Record<StatusType, Record<string, StatusStyle>> = {
  job: JOB_STATUSES,
  invoice: INVOICE_STATUSES,
  proposal: PROPOSAL_STATUSES,
}

interface StatusBadgeProps {
  status: string | null | undefined
  type: StatusType
  className?: string
}

export function StatusBadge({ status, type, className }: StatusBadgeProps) {
  if (!status) return null
  const style = TYPE_MAP[type][status] ?? {
    label: status.replace(/_/g, ' '),
    className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  }
  return (
    <Badge variant="outline" className={cn(style.className, className)}>
      {style.label}
    </Badge>
  )
}
