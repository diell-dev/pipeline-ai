'use client'

/**
 * Books → Vendors list. Simple CRUD master data.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Truck, Plus, Search } from 'lucide-react'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

interface Vendor {
  id: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  payment_terms_days: number
  is_active: boolean
}

export default function VendorsListPage() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books/vendors')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setVendors(data.vendors as Vendor[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const { PullIndicator } = usePullToRefresh({ onRefresh: load })

  const filtered = q.trim()
    ? vendors.filter((v) =>
        v.name.toLowerCase().includes(q.toLowerCase()) ||
        (v.email ?? '').toLowerCase().includes(q.toLowerCase())
      )
    : vendors

  return (
    <div className="relative space-y-4">
      <PullIndicator />
      <PageHeader
        title="Vendors"
        subtitle="People and companies you pay. Bills and expenses tie back here."
        actions={
          <Link href="/books/vendors/new">
            <Button><Plus className="mr-1 h-4 w-4" />New vendor</Button>
          </Link>
        }
      />

      <div className="relative w-72">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor name or email" className="pl-8 h-9" />
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No vendors yet"
          description="Add your first vendor. Future bills can reference them."
          action={<Link href="/books/vendors/new"><Button>Add vendor</Button></Link>}
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Contact</th>
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Phone</th>
                <th className="text-right px-3 py-2 font-medium">Terms</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.id} className="border-b last:border-0 hover:bg-muted">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/books/vendors/${v.id}`} className="hover:underline">{v.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{v.contact_name ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.email ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.phone ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.payment_terms_days}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
