'use client'

import { useEffect, useState, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ItemForm, type ItemFormValues } from '@/components/books/item-form'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'

interface Account { id: string; code: string; name: string; type: string }

export default function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [initial, setInitial] = useState<Partial<ItemFormValues> | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [iRes, aRes] = await Promise.all([
      fetch(`/api/books/items/${id}`).then((r) => r.json()),
      fetch('/api/books/accounts').then((r) => r.json()),
    ])
    if (iRes.error) { toast.error(iRes.error); return }
    const it = iRes.item
    setName(it.name)
    setInitial({
      name: it.name ?? '',
      description: it.description ?? '',
      type: it.type ?? 'service',
      sku: it.sku ?? '',
      default_unit_price: ((it.default_unit_price_cents ?? 0) / 100).toFixed(2),
      default_income_account_id: it.default_income_account_id ?? '',
      default_expense_account_id: it.default_expense_account_id ?? '',
    })
    setAccounts((aRes.accounts ?? []) as Account[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function submit(values: ItemFormValues) {
    const res = await fetch(`/api/books/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        description: values.description || null,
        type: values.type,
        sku: values.sku || null,
        default_unit_price: values.default_unit_price,
        default_income_account_id: values.default_income_account_id || null,
        default_expense_account_id: values.default_expense_account_id || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Failed'); return }
    toast.success('Item saved')
    setName(data.item.name)
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/items/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Item archived')
      router.push('/books/items')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (loading || !initial) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <PageHeader
        title={name}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Items', href: '/books/items' },
          { label: name },
        ]}
        actions={
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1 h-4 w-4" /> Archive
          </Button>
        }
      />
      <ItemForm initial={initial} accounts={accounts} onSubmit={submit} submitLabel="Save changes" />

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive {name}?</DialogTitle>
            <DialogDescription>Soft-deletes the item; past invoice lines stay intact.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Archiving…</> : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
