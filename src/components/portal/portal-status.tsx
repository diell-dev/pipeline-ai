'use client'

/**
 * Client-facing status pills. The staff app's StatusBadge uses INTERNAL
 * labels ("Sent to Client", "sent_to_client") which are confusing/wrong from
 * a client's point of view — they ARE the client. This maps the handful of
 * statuses a client can see to plain, client-friendly language.
 */
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Kind = 'job' | 'invoice' | 'proposal'

const MAPS: Record<Kind, Record<string, { label: string; cls: string }>> = {
  job: {
    scheduled: { label: 'Scheduled', cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
    sent: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  },
  invoice: {
    sent: { label: 'Unpaid', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    partially_paid: { label: 'Partially paid', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    void: { label: 'Void', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  },
  proposal: {
    sent_to_client: { label: 'Awaiting your approval', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    client_approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    client_rejected: { label: 'Declined', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    converted_to_job: { label: 'Scheduled', cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
  },
}

export function PortalStatus({ kind, status }: { kind: Kind; status: string }) {
  const m = MAPS[kind][status] ?? { label: status.replace(/_/g, ' '), cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' }
  return <Badge className={cn('border-transparent font-medium', m.cls)}>{m.label}</Badge>
}
