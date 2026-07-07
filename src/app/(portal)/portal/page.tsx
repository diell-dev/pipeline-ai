'use client'

/**
 * Portal Home — outstanding balance, next visit, proposals awaiting approval,
 * plus recent service. All reads are RLS-scoped to the client's own company.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PortalStatus } from '@/components/portal/portal-status'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatDate } from '@/lib/books/format'
import { ReceiptText, CalendarClock, FileSignature, ChevronRight, Wrench, Plus } from 'lucide-react'

interface JobRow { id: string; service_date: string; scheduled_time: string | null; status: string; sites: { name: string | null; address: string | null } | null }

export default function PortalHome() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [company, setCompany] = useState('')
  const [outstanding, setOutstanding] = useState(0)
  const [nextVisit, setNextVisit] = useState<JobRow | null>(null)
  const [openProposals, setOpenProposals] = useState(0)
  const [recent, setRecent] = useState<JobRow[]>([])

  useEffect(() => {
    if (!user?.client_id) return
    const cid = user.client_id
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const today = new Date().toISOString().slice(0, 10)
      const [clientRes, invRes, nextRes, propRes, recentRes] = await Promise.all([
        supabase.from('clients').select('company_name').eq('id', cid).maybeSingle<{ company_name: string }>(),
        supabase.from('invoices').select('balance_due_cents').eq('client_id', cid).gt('balance_due_cents', 0),
        supabase.from('jobs').select('id, service_date, scheduled_time, status, sites(name,address)')
          .eq('client_id', cid).eq('status', 'scheduled').gte('service_date', today)
          .order('service_date', { ascending: true }).limit(1).maybeSingle<JobRow>(),
        supabase.from('proposals').select('id', { count: 'exact', head: true })
          .eq('client_id', cid).eq('status', 'sent_to_client'),
        supabase.from('jobs').select('id, service_date, scheduled_time, status, sites(name,address)')
          .eq('client_id', cid).in('status', ['sent', 'completed'])
          .order('service_date', { ascending: false }).limit(4),
      ])
      setCompany(clientRes.data?.company_name ?? '')
      setOutstanding((invRes.data ?? []).reduce((s, r) => s + (r.balance_due_cents ?? 0), 0))
      setNextVisit(nextRes.data ?? null)
      setOpenProposals(propRes.count ?? 0)
      setRecent((recentRes.data as unknown as JobRow[]) ?? [])
      setLoading(false)
    })()
  }, [user?.client_id])

  const kpis = [
    {
      label: 'Outstanding balance', icon: ReceiptText, href: '/portal/invoices',
      value: loading ? null : formatCurrency(outstanding),
    },
    {
      label: 'Next scheduled visit', icon: CalendarClock, href: '/portal/visits',
      value: loading ? null : nextVisit ? formatDate(nextVisit.service_date) : 'None scheduled',
    },
    {
      label: 'Awaiting your approval', icon: FileSignature, href: '/portal/proposals',
      value: loading ? null : `${openProposals} ${openProposals === 1 ? 'proposal' : 'proposals'}`,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Welcome{company ? `, ${company}` : ''}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your jobs, invoices, and upcoming visits — all in one place.</p>
        </div>
        <Link href="/portal/request">
          <Button size="sm" className="h-9 shrink-0"><Plus className="mr-1.5 h-4 w-4" />Request service</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpis.map(({ label, icon: Icon, href, value }) => (
          <Link key={label} href={href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{label}</span>
                </div>
                {value === null
                  ? <Skeleton className="mt-2 h-7 w-24" />
                  : <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent service</h2>
          <Link href="/portal/service" className="text-xs font-medium text-brand-primary">View all</Link>
        </div>
        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : recent.length === 0 ? (
          <Card><CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <Wrench className="h-4 w-4" /> No completed service yet.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {recent.map((j) => (
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
    </div>
  )
}
