'use client'

/**
 * Books → Chart of Accounts.
 *
 * Hierarchical view: grouped by type (asset / liability / equity / income /
 * expense), each section sorted by code. Inline "Add account" opens a
 * Dialog (responsive bottom sheet on mobile). Each row supports rename,
 * deactivate, and delete (deletion blocked for is_system rows).
 */
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogBody,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { ListTree, Plus, Loader2, Trash2, PenLine } from 'lucide-react'

interface Account {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string
  is_system: boolean
  is_active: boolean
  notes: string | null
}

const TYPE_LABEL: Record<Account['type'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

const TYPE_ORDER: Account['type'][] = ['asset', 'liability', 'equity', 'income', 'expense']

const SUBTYPES_BY_TYPE: Record<Account['type'], string[]> = {
  asset: ['current_asset', 'non_current_asset', 'contra_asset', 'fixed_asset', 'accounts_receivable', 'bank', 'cash'],
  liability: ['current_liability', 'long_term_liability', 'accounts_payable'],
  equity: ['equity', 'retained_earnings', 'contra_equity'],
  income: ['operating_income', 'other_income', 'contra_revenue'],
  expense: ['cogs', 'operating_expense', 'other_expense', 'depreciation_expense'],
}

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/books/accounts')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setAccounts(data.accounts as Account[])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/books/accounts/${confirmDelete.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(`${confirmDelete.code} ${confirmDelete.name} archived`)
      setConfirmDelete(null)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chart of Accounts"
        subtitle="Every account the ledger posts against. System accounts cannot be deleted but can be renamed."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add account
          </Button>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title="No accounts seeded"
          description="Run the setup wizard to seed the standard US small-business chart."
        />
      ) : (
        <div className="space-y-4">
          {TYPE_ORDER.map((type) => {
            const section = accounts.filter((a) => a.type === type)
            if (section.length === 0) return null
            return (
              <Card key={type}>
                <CardHeader>
                  <CardTitle>{TYPE_LABEL[type]}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-3 py-2 font-medium w-24">Code</th>
                        <th className="text-left px-3 py-2 font-medium">Name</th>
                        <th className="text-left px-3 py-2 font-medium">Subtype</th>
                        <th className="text-center px-3 py-2 font-medium w-20">Status</th>
                        <th className="text-right px-3 py-2 font-medium w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.map((a) => (
                        <tr key={a.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                          <td className="px-3 py-2">
                            {a.name}
                            {a.is_system && (
                              <Badge variant="outline" className="ml-2 text-[10px]">system</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground text-xs">{a.subtype}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="outline" className="text-[10px]">
                              {a.is_active ? 'active' : 'inactive'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} aria-label="Edit">
                              <PenLine className="h-3.5 w-3.5" />
                            </Button>
                            {!a.is_system && (
                              <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(a)} aria-label="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <AccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
        onDone={() => { setAddOpen(false); load() }}
      />
      <AccountDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        account={editing ?? undefined}
        onDone={() => { setEditing(null); load() }}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !deleting && !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive account?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.code} {confirmDelete?.name} is soft-deleted. Existing entries against it remain intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Archiving…</> : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AccountDialog({
  open, onOpenChange, mode, account, onDone,
}: {
  open: boolean
  onOpenChange: (b: boolean) => void
  mode: 'create' | 'edit'
  account?: Account
  onDone: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<Account['type']>('expense')
  const [subtype, setSubtype] = useState<string>('operating_expense')
  const [active, setActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && account) {
      setCode(account.code)
      setName(account.name)
      setType(account.type)
      setSubtype(account.subtype)
      setActive(account.is_active)
    } else {
      setCode('')
      setName('')
      setType('expense')
      setSubtype('operating_expense')
      setActive(true)
    }
  }, [open, mode, account])

  async function submit() {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required')
      return
    }
    setSubmitting(true)
    try {
      const path = mode === 'create' ? '/api/books/accounts' : `/api/books/accounts/${account?.id}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const body = mode === 'create'
        ? { code, name, type, subtype }
        : (account?.is_system
          ? { name, is_active: active }
          : { code, name, type, subtype, is_active: active })
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(mode === 'create' ? 'Account added' : 'Account saved')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const subtypes = SUBTYPES_BY_TYPE[type]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add account' : 'Edit account'}</DialogTitle>
          <DialogDescription>
            {account?.is_system
              ? 'System account — code, type, and subtype are locked.'
              : 'Custom account — you can rename, recategorize, and deactivate anytime.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-code" required>Code</Label>
              <Input id="a-code" value={code} disabled={account?.is_system}
                onChange={(e) => setCode(e.target.value)} placeholder="e.g. 6850" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-type">Type</Label>
              <select id="a-type" value={type} disabled={account?.is_system}
                onChange={(e) => {
                  const newType = e.target.value as Account['type']
                  setType(newType)
                  setSubtype(SUBTYPES_BY_TYPE[newType][0])
                }}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
                {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-name" required>Name</Label>
            <Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-sub">Subtype</Label>
            <select id="a-sub" value={subtype} disabled={account?.is_system}
              onChange={(e) => setSubtype(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm">
              {subtypes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {mode === 'edit' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active (posting allowed)
            </label>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Saving…</> : mode === 'create' ? 'Add' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
