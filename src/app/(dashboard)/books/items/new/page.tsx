'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemForm, type ItemFormValues } from '@/components/books/item-form'
import { toast } from 'sonner'

interface Account { id: string; code: string; name: string; type: string }

export default function NewItemPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/books/accounts').then((r) => r.json()).then((d) => {
      setAccounts((d.accounts ?? []) as Account[])
      setLoading(false)
    })
  }, [])

  async function submit(values: ItemFormValues) {
    const res = await fetch('/api/books/items', {
      method: 'POST',
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
    toast.success(`${data.item.name} created`)
    router.push(`/books/items/${data.item.id}`)
  }

  if (loading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="New item"
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Items', href: '/books/items' },
          { label: 'New' },
        ]}
      />
      <ItemForm accounts={accounts} onSubmit={submit} />
    </div>
  )
}
