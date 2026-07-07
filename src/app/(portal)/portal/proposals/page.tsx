'use client'

/** Proposals — review & approve (links to the existing e-sign page) + history. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/books/format'
import { FileSignature } from 'lucide-react'

interface Prop { id: string; proposal_number: string; status: string; total_amount: number; public_token: string | null; created_at: string }

export default function PortalProposalsPage() {
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Prop[]>([])

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('proposals')
        .select('id, proposal_number, status, total_amount, public_token, created_at')
        .eq('client_id', user.client_id as string)
        .order('created_at', { ascending: false })
      setRows((data as Prop[]) ?? [])
      setLoading(false)
    })()
  }, [user?.client_id])

  return (
    <div className="space-y-4">
      <PageHeader title="Proposals" subtitle="Review and approve estimates." />
      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState icon={FileSignature} title="No proposals" description="Estimates we send you will appear here." />
      ) : (
        <div className="space-y-2">
          {rows.map((p) => {
            const pending = p.status === 'sent_to_client' && p.public_token
            return (
              <Card key={p.id}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{p.proposal_number}</p>
                    <p className="text-xs text-muted-foreground">${Number(p.total_amount ?? 0).toFixed(2)} · {formatDate(p.created_at)}</p>
                  </div>
                  {pending ? (
                    <Link href={`/proposals/sign/${p.public_token}`}>
                      <Button size="sm" className="h-9">Review &amp; approve</Button>
                    </Link>
                  ) : (
                    <StatusBadge status={p.status} type="proposal" />
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
