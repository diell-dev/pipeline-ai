'use client'

/**
 * Books → Settings.
 *
 * Active surfaces:
 *   1. Accounting periods (open + locked). Lock the current period to
 *      freeze entries against it; only owner / super_admin can lock.
 *
 * Hidden until ready (see TODO below): fiscal-year picker, default tax
 * rate, Stripe → books deposit account. The previous "Coming soon" card
 * was a buyer-credibility hit on the demo, so we don't render anything
 * for unfinished features — they'll come back when wired up in B7.
 */
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Lock, Unlock } from 'lucide-react'
import { hasPermission } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth-store'
import { formatDate } from '@/lib/books/format'

interface Period {
  id: string
  name: string
  start_date: string
  end_date: string
  is_locked: boolean
  locked_at: string | null
}

export default function BooksSettingsPage() {
  const { user } = useAuthStore()
  const canLock = user?.role ? hasPermission(user.role, 'bookkeeping:lock_period') : false
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books/periods')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setPeriods(data.periods as Period[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function toggleLock(period: Period) {
    setWorking(period.id)
    try {
      const res = await fetch(`/api/books/periods/${period.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !period.is_locked }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`${period.name} ${period.is_locked ? 'unlocked' : 'locked'}`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Books settings" subtitle="Periods, fiscal year, and other ledger controls." />

      <Card>
        <CardHeader><CardTitle>Accounting periods</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No periods yet — run the setup wizard.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Range</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-muted-foreground">
                      {formatDate(p.start_date)} – {formatDate(p.end_date)}
                    </td>
                    <td className="py-2">
                      <Badge variant="outline">{p.is_locked ? 'locked' : 'open'}</Badge>
                    </td>
                    <td className="py-2 text-right">
                      {canLock ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleLock(p)}
                          disabled={working === p.id}
                        >
                          {working === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : p.is_locked ? (
                            <><Unlock className="mr-1 h-3 w-3" /> Unlock</>
                          ) : (
                            <><Lock className="mr-1 h-3 w-3" /> Lock</>
                          )}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Owner only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* TODO: enable in B7 — fiscal-year picker, default tax rate, and
          Stripe → books deposit-account routing. Hidden from customer
          UI until they actually work (audit flagged "coming soon" copy
          as a buyer-credibility risk on the demo). */}
    </div>
  )
}
