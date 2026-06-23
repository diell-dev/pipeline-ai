'use client'

/**
 * Books → Items list. Catalog of services / products used by invoices.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonList } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Boxes, Plus, Search } from 'lucide-react'
import { formatCurrency } from '@/lib/books/format'

interface Item {
  id: string
  name: string
  description: string | null
  type: 'service' | 'product' | 'bundle'
  sku: string | null
  default_unit_price_cents: number
  is_active: boolean
}

export default function ItemsListPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books/items')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setItems(data.items as Item[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = q.trim()
    ? items.filter((i) =>
        i.name.toLowerCase().includes(q.toLowerCase()) ||
        (i.sku ?? '').toLowerCase().includes(q.toLowerCase()))
    : items

  return (
    <div className="space-y-4">
      <PageHeader
        title="Items"
        subtitle="Reusable catalog of services and products. Pulled in when building invoices."
        actions={
          <Link href="/books/items/new">
            <Button><Plus className="mr-1 h-4 w-4" />New item</Button>
          </Link>
        }
      />

      <div className="relative w-72">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU" className="pl-8 h-9" />
      </div>

      {loading ? (
        <SkeletonList rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No items yet"
          description="Add services or products so building invoices is a few clicks."
          action={<Link href="/books/items/new"><Button>Add item</Button></Link>}
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">SKU</th>
                <th className="text-right px-3 py-2 font-medium">Default price</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} className="border-b last:border-0 hover:bg-muted">
                  <td className="px-3 py-2">
                    <Link href={`/books/items/${it.id}`} className="font-medium hover:underline">{it.name}</Link>
                    {it.description && (
                      <p className="text-xs text-muted-foreground truncate">{it.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2"><Badge variant="outline">{it.type}</Badge></td>
                  <td className="px-3 py-2 text-muted-foreground">{it.sku ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(it.default_unit_price_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
