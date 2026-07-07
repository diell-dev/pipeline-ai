'use client'

/** Staff view of incoming client service requests. */
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { formatDate } from '@/lib/books/format'
import { toast } from 'sonner'
import { Inbox } from 'lucide-react'

interface Req {
  id: string; summary: string; details: string | null; urgency: string; status: string
  preferred_date: string | null; created_at: string
  clients: { company_name: string } | null
  sites: { name: string | null; address: string | null } | null
}

const URGENCY_COLOR: Record<string, string> = {
  low: 'bg-zinc-100 text-zinc-700', normal: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700', emergency: 'bg-red-100 text-red-700',
}
const STATUSES = ['new', 'in_review', 'converted', 'declined', 'closed'] as const

export default function ServiceRequestsPage() {
  const { user } = useAuthStore()
  const canManage = user?.role ? hasPermission(user.role, 'service_requests:manage') : false
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Req[]>([])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('service_requests')
        .select('id, summary, details, urgency, status, preferred_date, created_at, clients(company_name), sites(name,address)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      setRows((data as unknown as Req[]) ?? [])
      setLoading(false)
    })()
  }, [])

  async function setStatus(id: string, status: string) {
    const supabase = createClient()
    const { error } = await supabase.from('service_requests').update({ status }).eq('id', id)
    if (error) { toast.error('Could not update'); return }
    toast.success('Updated')
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)))
  }

  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <PageHeader title="Service requests" subtitle="Requests submitted by clients through their portal." />
      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests yet" description="Requests clients submit from their portal show up here." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{r.clients?.company_name ?? 'Client'}</span>
                    <Badge className={URGENCY_COLOR[r.urgency] ?? URGENCY_COLOR.normal}>{r.urgency}</Badge>
                  </div>
                  {canManage ? (
                    <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}
                      className="h-8 rounded-md border bg-background px-2 text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  ) : (
                    <Badge variant="secondary">{r.status.replace('_', ' ')}</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{r.summary}</p>
                {r.details && <p className="mt-0.5 text-sm text-muted-foreground">{r.details}</p>}
                <p className="mt-2 text-xs text-muted-foreground">
                  {r.sites?.name || r.sites?.address || 'No building specified'} · submitted {formatDate(r.created_at)}
                  {r.preferred_date ? ` · prefers ${formatDate(r.preferred_date)}` : ''}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
