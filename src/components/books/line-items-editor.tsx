'use client'

/**
 * LineItemsEditor — shared editable line-item grid for the invoice + bill
 * creation forms.
 *
 * Each line carries: description, account picker (revenue accounts for
 * invoices, expense accounts for bills), quantity, unit price, optional
 * tax. Total per line is recomputed live; the parent gets a callback
 * with the array of lines (and the running totals via `onChange`).
 *
 * Designed for mobile too — on small screens each line is a stacked card
 * rather than a row.
 */
import { useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Plus, Trash2 } from 'lucide-react'
import { formatCurrency, dollarsToCents } from '@/lib/books/format'

export interface LineRow {
  description: string
  account_id: string
  quantity: string
  unit_price: string
  tax_amount: string
  is_taxable: boolean
}

interface Account {
  id: string
  code: string
  name: string
  type: string
}

export function emptyLine(): LineRow {
  return {
    description: '',
    account_id: '',
    quantity: '1',
    unit_price: '0',
    tax_amount: '0',
    is_taxable: false,
  }
}

export function computeLineTotalsCents(line: LineRow) {
  const qty = Number.parseFloat(line.quantity || '0') || 0
  const unit = dollarsToCents(line.unit_price)
  const tax = dollarsToCents(line.tax_amount)
  const subtotalCents = Math.round(qty * unit)
  return { subtotalCents, taxCents: tax, totalCents: subtotalCents + tax }
}

interface LineItemsEditorProps {
  lines: LineRow[]
  onChange: (lines: LineRow[]) => void
  accounts: Account[]
  /** Filter accounts shown in the picker by type — 'income' for invoices,
   *  'expense' for bills. Pass null to allow all. */
  accountTypeFilter?: 'income' | 'expense' | null
  disabled?: boolean
}

export function LineItemsEditor({
  lines, onChange, accounts, accountTypeFilter = null, disabled,
}: LineItemsEditorProps) {
  const visibleAccounts = useMemo(() => {
    if (!accountTypeFilter) return accounts
    return accounts.filter((a) => a.type === accountTypeFilter)
  }, [accounts, accountTypeFilter])

  // Ensure at least one line exists.
  useEffect(() => {
    if (lines.length === 0) onChange([emptyLine()])
  }, [lines.length, onChange])

  function update(idx: number, patch: Partial<LineRow>) {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function remove(idx: number) {
    const next = lines.filter((_, i) => i !== idx)
    onChange(next.length === 0 ? [emptyLine()] : next)
  }
  function add() {
    onChange([...lines, emptyLine()])
  }

  return (
    <div className="space-y-3">
      <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-muted-foreground uppercase tracking-wide px-1">
        <div className="col-span-4">Description</div>
        <div className="col-span-3">Account</div>
        <div className="col-span-1">Qty</div>
        <div className="col-span-2 text-right">Unit price</div>
        <div className="col-span-1 text-right">Total</div>
        <div className="col-span-1"></div>
      </div>

      {lines.map((line, idx) => {
        const { totalCents } = computeLineTotalsCents(line)
        return (
          <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start p-3 md:p-0 md:py-1 rounded-lg md:rounded-none border md:border-0 md:border-b last:border-0 bg-card md:bg-transparent">
            <div className="md:col-span-4 space-y-1">
              <Label className="md:hidden text-xs">Description</Label>
              <Input
                value={line.description}
                onChange={(e) => update(idx, { description: e.target.value })}
                placeholder="What was sold / consumed"
                disabled={disabled}
              />
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="md:hidden text-xs">Account</Label>
              <select
                value={line.account_id}
                onChange={(e) => update(idx, { account_id: e.target.value })}
                disabled={disabled}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                <option value="">— pick —</option>
                {visibleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2 md:contents">
              <div className="md:col-span-1 space-y-1">
                <Label className="md:hidden text-xs">Qty</Label>
                <Input
                  value={line.quantity}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                  inputMode="decimal"
                  disabled={disabled}
                />
              </div>
              <div className="md:col-span-2 space-y-1">
                <Label className="md:hidden text-xs">Unit price</Label>
                <Input
                  value={line.unit_price}
                  onChange={(e) => update(idx, { unit_price: e.target.value })}
                  inputMode="decimal"
                  className="md:text-right"
                  disabled={disabled}
                />
              </div>
              <div className="md:col-span-1 space-y-1 text-right">
                <Label className="md:hidden text-xs">Total</Label>
                <p className="text-sm font-medium tabular-nums pt-2">
                  {formatCurrency(totalCents)}
                </p>
              </div>
            </div>
            <div className="md:col-span-1 flex md:justify-end md:items-start pt-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(idx)}
                disabled={disabled}
                aria-label="Remove line"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )
      })}

      <Button variant="outline" size="sm" onClick={add} disabled={disabled}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add line
      </Button>
    </div>
  )
}
