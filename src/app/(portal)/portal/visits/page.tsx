'use client'

/**
 * Upcoming visits — the client's scheduled jobs.
 *
 * We split still-scheduled jobs into two sections:
 *   1. Upcoming — service_date >= today, soonest first.
 *   2. Awaiting reschedule — service_date < today but status is still
 *      'scheduled' (the visit didn't happen and hasn't been marked
 *      complete or moved yet). Without this section, a customer would
 *      see "No upcoming visits" while Service History still displayed
 *      "Scheduled" badges — a confusing mismatch.
 */
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/books/format'
import { CalendarClock, MapPin, AlertCircle } from 'lucide-react'

interface Visit {
  id: string
  service_date: string
  scheduled_time: string | null
  sites: { name: string | null; address: string | null } | null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function VisitCard({ v, tone = 'brand' }: { v: Visit; tone?: 'brand' | 'amber' }) {
  const time = v.scheduled_time
    ? new Date(v.scheduled_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null
  const iconBg =
    tone === 'amber'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-brand-primary/10 text-brand-primary'
  const Icon = tone === 'amber' ? AlertCircle : CalendarClock
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-lg ${iconBg}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {formatDate(v.service_date)}
            {time ? ` · ${time}` : ''}
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 flex-shrink-0" />{' '}
            {v.sites?.name || v.sites?.address || 'Your property'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function PortalVisitsPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [upcoming, setUpcoming] = useState<Visit[]>([])
  const [awaitingReschedule, setAwaitingReschedule] = useState<Visit[]>([])

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      // Fetch ALL still-scheduled jobs (no date filter). We split into
      // upcoming vs awaiting-reschedule in memory so past-dated
      // scheduled jobs don't just vanish from the customer's view.
      const { data } = await supabase
        .from('jobs')
        .select('id, service_date, scheduled_time, sites(name,address)')
        .eq('client_id', user.client_id as string)
        .eq('status', 'scheduled')
        .order('service_date', { ascending: true })
      const all = (data as unknown as Visit[]) ?? []
      const today = todayIso()
      setUpcoming(all.filter((v) => v.service_date >= today))
      // Past-dated ones — most recent first so the least-stale shows up top
      setAwaitingReschedule(
        all.filter((v) => v.service_date < today).reverse()
      )
      setLoading(false)
    })()
  }, [user?.client_id])

  const hasAny = upcoming.length > 0 || awaitingReschedule.length > 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Upcoming visits"
        subtitle="When we’re next scheduled at your property."
      />

      {loading ? (
        <SkeletonList />
      ) : !hasAny ? (
        <EmptyState
          icon={CalendarClock}
          title="No upcoming visits"
          description="Scheduled visits will show up here."
        />
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Upcoming
              </h2>
              <div className="space-y-2">
                {upcoming.map((v) => (
                  <VisitCard key={v.id} v={v} />
                ))}
              </div>
            </section>
          )}

          {awaitingReschedule.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Awaiting reschedule
              </h2>
              <p className="text-xs text-muted-foreground">
                These were scheduled but didn’t happen. We’ll reach out to
                confirm a new date.
              </p>
              <div className="space-y-2">
                {awaitingReschedule.map((v) => (
                  <VisitCard key={v.id} v={v} tone="amber" />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
