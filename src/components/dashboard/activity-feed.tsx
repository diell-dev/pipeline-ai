'use client'

/**
 * DashboardActivityFeed — Phase D
 *
 * Cross-entity activity timeline for the dashboard homepage. Unlike the
 * per-job <JobActivityTimeline> (which only shows activity for a single
 * entity_id), this surfaces the most recent N events across the entire
 * organization: jobs created/approved/sent, invoices paid/marked-paid,
 * equipment registered, proposals signed, etc.
 *
 * Each row links into the relevant detail page so the dashboard becomes
 * a jumping-off point for triage instead of a dead read-only wall.
 *
 * Fetches from /api/dashboard/activity (org-scoped, super_admin sees all).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileSignature,
  FileText,
  Plus,
  QrCode,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

interface ActivityEntry {
  id: string
  action: string
  entity_type: string
  entity_id: string
  metadata: Record<string, unknown> | null
  createdAt: string
  userName: string
}

interface ActionConfig {
  label: string
  icon: LucideIcon
  /** Semantic tone for the dot (maps to a Tailwind class). */
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'
}

/**
 * Maps each `activity_log.action` to a human-readable label, icon, and tone.
 * Action enum is defined in src/types/database.ts (ActivityAction); we keep
 * a small subset here — entries with no mapping fall back to a generic label.
 */
const ACTION_CONFIG: Record<string, ActionConfig> = {
  // Job lifecycle
  job_created:       { label: 'created a job',        icon: Plus,           tone: 'info' },
  job_submitted:     { label: 'submitted a job',      icon: Send,           tone: 'info' },
  job_approved:      { label: 'approved a job',       icon: CheckCircle2,   tone: 'success' },
  job_rejected:      { label: 'rejected a job',       icon: XCircle,        tone: 'danger' },
  job_completed:     { label: 'completed a job',      icon: CheckCircle2,   tone: 'success' },
  job_sent:          { label: 'sent report & invoice',icon: Send,           tone: 'brand' },
  job_cancelled:     { label: 'cancelled a job',      icon: XCircle,        tone: 'neutral' },
  job_scheduled:     { label: 'scheduled a job',      icon: ClipboardList,  tone: 'info' },
  job_started:       { label: 'started a job',        icon: ClipboardList,  tone: 'info' },
  revision_requested:{ label: 'requested a revision', icon: ClipboardList,  tone: 'warning' },

  // Invoices
  invoice_created:       { label: 'created an invoice',     icon: FileText,     tone: 'info' },
  invoice_sent:          { label: 'sent an invoice',        icon: Send,         tone: 'brand' },
  invoice_paid:          { label: 'marked invoice paid',    icon: DollarSign,   tone: 'success' },
  invoice_marked_paid:   { label: 'marked invoice paid',    icon: DollarSign,   tone: 'success' },
  invoice_paid_via_stripe:{ label: 'received Stripe payment', icon: DollarSign, tone: 'success' },
  invoice_voided:        { label: 'voided an invoice',      icon: XCircle,      tone: 'neutral' },
  payment_recorded:      { label: 'recorded a payment',     icon: DollarSign,   tone: 'success' },

  // Proposals
  proposal_created:           { label: 'created a proposal',      icon: FileSignature, tone: 'info' },
  proposal_sent_to_client:    { label: 'sent a proposal',         icon: Send,          tone: 'brand' },
  proposal_signed_by_client:  { label: 'signed a proposal',       icon: FileSignature, tone: 'success' },
  proposal_rejected_by_client:{ label: 'rejected a proposal',     icon: XCircle,       tone: 'danger' },
  proposal_converted_to_job:  { label: 'converted proposal → job',icon: ClipboardList, tone: 'brand' },

  // Equipment
  equipment_registered:        { label: 'registered equipment',    icon: QrCode,        tone: 'info' },
  equipment_qr_batch_generated:{ label: 'generated a QR batch',    icon: QrCode,        tone: 'neutral' },
  equipment_service_requested: { label: 'requested service',       icon: QrCode,        tone: 'warning' },
  equipment_inspected:         { label: 'inspected equipment',     icon: CheckCircle2,  tone: 'success' },

  // CRM
  client_created: { label: 'added a client', icon: Plus, tone: 'info' },
  site_created:   { label: 'added a site',   icon: Plus, tone: 'info' },
  user_invited:   { label: 'invited a teammate', icon: Plus, tone: 'info' },
}

const TONE_CLASSES: Record<ActionConfig['tone'], string> = {
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  danger:  'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  info:    'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  brand:   'bg-brand-primary/10 text-brand-primary',
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  job:                (id) => `/jobs/${id}`,
  invoice:            (id) => `/invoices/${id}`,
  proposal:           (id) => `/proposals/${id}`,
  client:             (id) => `/clients/${id}`,
  site:               () => `/clients`, // no per-site page; route back to clients
  equipment:          (id) => `/equipment/${id}`,
  user:               () => `/team`,
  crew:               () => `/schedule`,
  recurring_schedule: () => `/schedule`,
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const m = Math.floor(diffMs / 60_000)
  const h = Math.floor(diffMs / 3_600_000)
  const days = Math.floor(diffMs / 86_400_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface DashboardActivityFeedProps {
  /** Max entries to fetch. Default 10. */
  limit?: number
  /** When true, render without the surrounding Card (used by mobile feed). */
  bare?: boolean
  className?: string
}

export function DashboardActivityFeed({
  limit = 10,
  bare = false,
  className,
}: DashboardActivityFeedProps) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const res = await fetch(`/api/dashboard/activity?limit=${limit}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = (await res.json()) as { entries: ActivityEntry[] }
        if (!cancelled) setEntries(json.entries || [])
      } catch (err) {
        console.error('Dashboard activity fetch failed', err)
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [limit])

  const body = (
    <>
      {loading ? (
        <div className="space-y-3 px-1 py-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          Couldn&apos;t load recent activity. Try refreshing.
        </p>
      ) : !entries || entries.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Recent jobs, invoices, and equipment changes will show up here."
          card={false}
          className="py-10"
        />
      ) : (
        <ul className="space-y-1">
          {entries.map((entry, idx) => {
            const config = ACTION_CONFIG[entry.action] ?? {
              label: entry.action.replace(/_/g, ' '),
              icon: Activity,
              tone: 'neutral' as const,
            }
            const Icon = config.icon
            const buildHref = ENTITY_HREF[entry.entity_type]
            const href = buildHref ? buildHref(entry.entity_id) : null

            const inner = (
              <div
                className={cn(
                  'group flex items-start gap-3 rounded-lg px-2 py-2 -mx-1 transition-colors',
                  href && 'hover:bg-muted/60 cursor-pointer'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    TONE_CLASSES[config.tone]
                  )}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-sm leading-snug">
                    <span className="font-medium text-foreground">
                      {entry.userName}
                    </span>{' '}
                    <span className="text-muted-foreground">{config.label}</span>
                  </p>
                  <p
                    className="mt-0.5 text-xs text-muted-foreground"
                    title={fullTimestamp(entry.createdAt)}
                  >
                    {relativeTime(entry.createdAt)}
                  </p>
                </div>
              </div>
            )

            return (
              <li key={entry.id ?? idx}>
                {href ? (
                  <Link
                    href={href}
                    className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )

  if (bare) {
    return <div className={cn('space-y-3', className)}>{body}</div>
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          Recent activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  )
}

export default DashboardActivityFeed
