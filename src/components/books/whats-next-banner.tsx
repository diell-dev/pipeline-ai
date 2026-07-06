'use client'

/**
 * <WhatsNextBanner> — contextual nudge above the invoice paper preview.
 *
 * Mirrors PBAccounting's "What's next?" strip: one line of copy plus one
 * or two inline actions, tuned to the invoice's lifecycle state.
 *
 * Returns null for terminal states (paid, void) — no nudge to show.
 * Overdue invoices flip to a red-tinted variant so the collection urgency
 * reads at a glance.
 */
import { Button } from '@/components/ui/button'
import { formatCurrency, daysBetween, todayIso } from '@/lib/books/format'
import type { InvoiceStatus } from '@/types/database'

interface WhatsNextBannerProps {
  status: InvoiceStatus
  balanceDueCents: number
  dueDate: string | null
  onSend: () => void
  onMarkSent: () => void
  onRecordPayment: () => void
}

export function WhatsNextBanner({
  status,
  balanceDueCents,
  dueDate,
  onSend,
  onMarkSent,
  onRecordPayment,
}: WhatsNextBannerProps) {
  const overdue =
    (status === 'sent' || status === 'partially_paid' || status === 'overdue') &&
    !!dueDate &&
    daysBetween(dueDate, todayIso()) > 0

  // Terminal — nothing to nudge.
  if (status === 'paid' || status === 'void') return null

  let message: string
  let actions: React.ReactNode
  let tone: 'default' | 'urgent' = 'default'

  if (status === 'draft') {
    message = 'Send this invoice to your customer or mark it as Sent.'
    actions = (
      <>
        <Button size="sm" onClick={onSend}>
          Email now
        </Button>
        <Button size="sm" variant="outline" onClick={onMarkSent}>
          Mark as sent
        </Button>
      </>
    )
  } else if (status === 'partially_paid') {
    message = `Partial payment received. ${formatCurrency(balanceDueCents)} still due.`
    actions = (
      <Button size="sm" onClick={onRecordPayment}>
        Record payment
      </Button>
    )
    if (overdue) tone = 'urgent'
  } else if (overdue || status === 'overdue') {
    const days = dueDate ? daysBetween(dueDate, todayIso()) : 0
    tone = 'urgent'
    message =
      days > 0
        ? `This invoice is ${days} day${days === 1 ? '' : 's'} past due.`
        : 'This invoice is past due.'
    actions = (
      <Button size="sm" onClick={onRecordPayment}>
        Record payment
      </Button>
    )
  } else {
    // sent (not overdue)
    message = `Waiting for payment. Balance due ${formatCurrency(balanceDueCents)}.`
    actions = (
      <Button size="sm" onClick={onRecordPayment}>
        Record payment
      </Button>
    )
  }

  const wrap =
    tone === 'urgent'
      ? 'rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
      : 'rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30'

  const label =
    tone === 'urgent'
      ? 'text-red-700 dark:text-red-300'
      : 'text-emerald-700 dark:text-emerald-300'

  const body =
    tone === 'urgent'
      ? 'text-red-900 dark:text-red-100'
      : 'text-emerald-900 dark:text-emerald-100'

  return (
    <div
      className={`${wrap} flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between print:hidden`}
      role="status"
    >
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <span className={`text-[0.65rem] font-semibold uppercase tracking-wider ${label}`}>
          What&rsquo;s next?
        </span>
        <span className={`text-sm ${body}`}>{message}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}
