'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { VendorForm, type VendorFormValues } from '@/components/books/vendor-form'
import { toast } from 'sonner'

interface Account { id: string; code: string; name: string; type: string }

export default function NewVendorPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/books/accounts').then((r) => r.json()).then((d) => {
      setAccounts((d.accounts ?? []) as Account[])
      setLoading(false)
    })
  }, [])

  async function handleSubmit(values: VendorFormValues) {
    const res = await fetch('/api/books/vendors', {
      method: 'POST',
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
    toast.success(`${data.vendor.name} created`)
    router.push(`/books/vendors/${data.vendor.id}`)
  }

  if (loading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="New vendor"
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Vendors', href: '/books/vendors' },
          { label: 'New' },
        ]}
      />
      <VendorForm accounts={accounts} onSubmit={handleSubmit} />
    </div>
  )
}
