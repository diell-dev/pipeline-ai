'use client'

/**
 * Job Activity Timeline
 *
 * Displays a chronological audit trail of every action taken on a job.
 * Fetches from the activity_log table filtered by entity_type='job' + entity_id.
 * Each entry shows: who did it, what they did, and when — with an icon and color.
 */

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import type { ActivityAction } from '@/types/database'

// ── Action display config ─────────────────────────────────────────────
// Maps each action to a human-readable label, icon emoji, and color class

interface ActionConfig {
  label: string
  icon: string
  dotColor: string // Tailwind bg class for the timeline dot
}

const ACTION_CONFIG: Partial<Record<ActivityAction, ActionConfig>> = {
  // Job lifecycle
  job_created:             { label: 'Created job',                      icon: '📋', dotColor: 'bg-blue-500' },
  job_submitted:           { label: 'Submitted job data',               icon: '📤', dotColor: 'bg-blue-500' },
  job_scheduled:           { label: 'Scheduled job',                    icon: '📅', dotColor: 'bg-cyan-500' },
  job_rescheduled:         { label: 'Rescheduled job',                  icon: '🔄', dotColor: 'bg-cyan-500' },
  job_assigned:            { label: 'Assigned job',                     icon: '👤', dotColor: 'bg-indigo-500' },
  job_started:             { label: 'Started job (arrived on site)',    icon: '🚛', dotColor: 'bg-sky-500' },
  job_ai_generating:       { label: 'AI started generating documents', icon: '🤖', dotColor: 'bg-purple-500' },
  job_ai_completed:        { label: 'AI finished generating documents',icon: '✅', dotColor: 'bg-purple-500' },
  job_approved:            { label: 'Approved job',                     icon: '✅', dotColor: 'bg-green-500' },
  job_rejected:            { label: 'Rejected job',                     icon: '❌', dotColor: 'bg-red-500' },
  job_completed:           { label: 'Marked job as completed',          icon: '🏁', dotColor: 'bg-emerald-500' },
  job_cancelled:           { label: 'Cancelled job',                    icon: '🚫', dotColor: 'bg-zinc-400' },
  job_sent:                { label: 'Sent report & invoice to client', icon: '📧', dotColor: 'bg-teal-500' },
  job_deleted:             { label: 'Deleted job',                      icon: '🗑️', dotColor: 'bg-red-500' },
  revision_requested:      { label: 'Requested revision',              icon: '✏️', dotColor: 'bg-orange-500' },
  report_manually_edited:  { label: 'Manually edited report',          icon: '📝', dotColor: 'bg-amber-500' },
  invoice_manually_edited: { label: 'Manually edited invoice',         icon: '💰', dotColor: 'bg-amber-500' },
  report_regenerated:      { label: 'Regenerated report & invoice',    icon: '🔁', dotColor: 'bg-purple-400' },
  // Invoice
  invoice_created:         { label: 'Invoice created',                  icon: '🧾', dotColor: 'bg-blue-400' },
  invoice_sent:            { label: 'Invoice sent',                     icon: '📨', dotColor: 'bg-teal-400' },
  invoice_paid:            { label: 'Invoice marked as paid',           icon: '💵', dotColor: 'bg-green-500' },
  invoice_voided:          { label: 'Invoice voided',                   icon: '🚫', dotColor: 'bg-red-400' },
}

const DEFAULT_CONFIG: ActionConfig = {
  label: 'Action performed',
  icon: '•',
  dotColor: 'bg-zinc-400',
}

// ── Types ─────────────────────────────────────────────────────────────

interface ActivityEntryRaw {
  id: string
  action: ActivityAction
  user_id: string
  metadata: Record<string, unknown> | null
  created_at: string
  user: { full_name: string }[] | { full_name: string } | null
}

interface ActivityEntry {
  id: string
  action: ActivityAction
  user_id: string
  metadata: Record<string, unknown> | null
  created_at: string
  userName: string
}

// ── Format helpers ────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  // "Just now" / "5m ago" / "2h ago" for recent, then full date
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getMetadataDetail(action: ActivityAction, metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null

  switch (action) {
    case 'job_rejected':
      return metadata.rejection_notes ? `Reason: ${metadata.rejection_notes}` : null
    case 'revision_requested':
      return metadata.revision_request ? `Note: ${metadata.revision_request}` : null
    case 'job_assigned':
      return metadata.assigned_to_name ? `Assigned to ${metadata.assigned_to_name}` : null
    case 'job_rescheduled':
      return metadata.reschedule_reason ? `Reason: ${metadata.reschedule_reason}` : null
    case 'job_sent':
      return metadata.sent_to ? `Sent to ${metadata.sent_to}` : null
    case 'invoice_paid':
      return metadata.amount ? `Amount: $${Number(metadata.amount).toFixed(2)}` : null
    default:
      return null
  }
}

// ── Component ─────────────────────────────────────────────────────────

export function JobActivityTimeline({ jobId }: { jobId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from('activity_log')
        .select('id, action, user_id, metadata, created_at, user:user_id ( full_name )')
        .eq('entity_type', 'job')
        .eq('entity_id', jobId)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Failed to load activity timeline:', error.message)
      } else {
        // Normalize Supabase's joined user (may be array or object)
        const normalized: ActivityEntry[] = ((data || []) as ActivityEntryRaw[]).map((row) => {
          let userName = 'System'
          if (Array.isArray(row.user) && row.user.length > 0) {
            userName = row.user[0].full_name
          } else if (row.user && !Array.isArray(row.user)) {
            userName = row.user.full_name
          }
          return {
            id: row.id,
            action: row.action,
            user_id: row.user_id,
            metadata: row.metadata,
            created_at: row.created_at,
            userName,
          }
        })
        setEntries(normalized)
      }
      setLoading(false)
    }

    if (jobId) load()
  }, [jobId])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Activity Timeline</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Activity Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground italic">
            No activity recorded yet. Actions will appear here as the job progresses.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Activity Timeline ({entries.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-zinc-200" />

          <div className="space-y-4">
            {entries.map((entry) => {
              const config = ACTION_CONFIG[entry.action] || {
                ...DEFAULT_CONFIG,
                label: entry.action.replace(/_/g, ' '),
              }
              const detail = getMetadataDetail(entry.action, entry.metadata)

              return (
                <div key={entry.id} className="relative flex gap-3 pl-0">
                  {/* Dot */}
                  <div className={`relative z-10 mt-0.5 h-6 w-6 rounded-full ${config.dotColor} flex items-center justify-center text-xs shrink-0`}>
                    <span className="leading-none">{config.icon}</span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium">{config.label}</span>
                      <span
                        className="text-xs text-muted-foreground cursor-help"
                        title={formatFullTimestamp(entry.created_at)}
                      >
                        {formatTimestamp(entry.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      by {entry.userName}
                    </p>
                    {detail && (
                      <p className="text-xs text-muted-foreground/80 mt-1 bg-zinc-50 px-2 py-1 rounded">
                        {detail}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
