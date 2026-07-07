'use client'

/** Upcoming visits — the client's scheduled jobs, soonest first. */
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/books/format'
import { CalendarClock, MapPin } from 'lucide-react'

interface Visit { id: string; service_date: string; scheduled_time: string | null; sites: { name: string | null; address: string | null } | null }

export default function PortalVisitsPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [visits, setVisits] = useState<Visit[]>([])

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase
        .from('jobs')
        .select('id, service_date, scheduled_time, sites(name,address)')
        .eq('client_id', user.client_id as string)
        .eq('status', 'scheduled')
        .gte('service_date', today)
        .order('service_date', { ascending: true })
      setVisits((data as unknown as Visit[]) ?? [])
      setLoading(false)
    })()
  }, [user?.client_id])

  return (
    <div className="space-y-4">
      <PageHeader title="Upcoming visits" subtitle="When we’re next scheduled at your property." />
      {loading ? (
        <SkeletonList />
      ) : visits.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No upcoming visits" description="Scheduled visits will show up here." />
      ) : (
        <div className="space-y-2">
          {visits.map((v) => {
            const time = v.scheduled_time ? new Date(v.scheduled_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null
            return (
              <Card key={v.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-11 w-11 flex-shrink-0 flex-col items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{formatDate(v.service_date)}{time ? ` · ${time}` : ''}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 flex-shrink-0" /> {v.sites?.name || v.sites?.address || 'Your property'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
