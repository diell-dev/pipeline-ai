'use client'

/** Service history — the client's jobs (past + upcoming), filterable by building. */
import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { PortalStatus } from '@/components/portal/portal-status'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/books/format'
import { Wrench, ChevronRight } from 'lucide-react'

interface JobRow { id: string; service_date: string; status: string; site_id: string | null; sites: { name: string | null; address: string | null } | null }

export default function PortalServicePage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [site, setSite] = useState<string>('all')

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('jobs')
        .select('id, service_date, status, site_id, sites(name,address)')
        .eq('client_id', user.client_id as string)
        .order('service_date', { ascending: false })
      setJobs((data as unknown as JobRow[]) ?? [])
      setLoading(false)
    })()
  }, [user?.client_id])

  const sites = useMemo(() => {
    const map = new Map<string, string>()
    for (const j of jobs) if (j.site_id) map.set(j.site_id, j.sites?.name || j.sites?.address || 'Site')
    return Array.from(map, ([id, name]) => ({ id, name }))
  }, [jobs])

  const filtered = site === 'all' ? jobs : jobs.filter((j) => j.site_id === site)

  return (
    <div className="space-y-4">
      <PageHeader title="Service history" subtitle="Your past and upcoming work." />

      {sites.length > 1 && (
        <select
          value={site}
          onChange={(e) => setSite(e.target.value)}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-64"
        >
          <option value="all">All buildings</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {loading ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Wrench} title="No service yet" description="Your completed and scheduled work will show up here." />
      ) : (
        <div className="space-y-2">
          {filtered.map((j) => (
            <Link key={j.id} href={`/portal/service/${j.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{j.sites?.name || j.sites?.address || 'Service visit'}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(j.service_date)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PortalStatus kind="job" status={j.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
