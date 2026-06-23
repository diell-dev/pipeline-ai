'use client'

import { useEffect, useState, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { VendorForm, type VendorFormValues } from '@/components/books/vendor-form'
import { toast } from 'sonner'
import { Trash2, Loader2 } from 'lucide-react'

interface Account { id: string; code: string; name: string; type: string }

export default function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [initial, setInitial] = useState<Partial<VendorFormValues> | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [vendorName, setVendorName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [vRes, aRes] = await Promise.all([
      fetch(`/api/books/vendors/${id}`).then((r) => r.json()),
      fetch('/api/books/accounts').then((r) => r.json()),
    ])
    if (vRes.error) {
      toast.error(vRes.error)
      return
    }
    setVendorName(vRes.vendor.name)
    setInitial({
      name: vRes.vendor.name ?? '',
      contact_name: vRes.vendor.contact_name ?? '',
      email: vRes.vendor.email ?? '',
      phone: vRes.vendor.phone ?? '',
      address_line1: vRes.vendor.address_line1 ?? '',
      city: vRes.vendor.city ?? '',
      state: vRes.vendor.state ?? '',
      postal_code: vRes.vendor.postal_code ?? '',
      tax_id: vRes.vendor.tax_id ?? '',
      payment_terms_days: vRes.vendor.payment_terms_days ?? 30,
      default_expense_account_id: vRes.vendor.default_expense_account_id ?? '',
      notes: vRes.vendor.notes ?? '',
    })
    setAccounts((aRes.accounts ?? []) as Account[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleSubmit(values: VendorFormValues) {
    const res = await fetch(`/api/books/vendors/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        default_expense_account_id: values.default_expense_account_id || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || 'Failed')
      return
    }
    toast.success('Vendor saved')
    setVendorName(data.vendor.name)
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/vendors/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success('Vendor archived')
      router.push('/books/vendors')
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
        title={vendorName}
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Vendors', href: '/books/vendors' },
          { label: vendorName },
        ]}
        actions={
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1 h-4 w-4" /> Archive
          </Button>
        }
      />
      <VendorForm initial={initial} accounts={accounts} onSubmit={handleSubmit} submitLabel="Save changes" />

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive {vendorName}?</DialogTitle>
            <DialogDescription>
              The vendor is soft-deleted and hidden from pickers. Existing bills keep referencing it.
            </DialogDescription>
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
