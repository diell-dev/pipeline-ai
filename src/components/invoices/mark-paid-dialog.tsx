'use client'

/**
 * MarkPaidDialog
 *
 * Controlled shadcn Dialog for marking an invoice paid (or partially paid).
 * The trigger is rendered by the consumer — the dialog wraps it.
 *
 * Usage:
 *   <MarkPaidDialog
 *     invoice={{ id, invoice_number, total_amount }}
 *     onSuccess={() => refetch()}
 *   >
 *     <Button>Mark Paid</Button>
 *   </MarkPaidDialog>
 *
 * Phase C polish: uses DialogBody + sticky DialogFooter so the action row
 * stays visible while the user scrolls a longer form (notes textarea), and
 * required-field markers come from the shared <Label required> primitive.
 */
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2 } from 'lucide-react'

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type PaymentMethod = 'check' | 'ach' | 'wire' | 'credit_card' | 'cash' | 'other'

const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire Transfer' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]

interface MarkPaidInvoice {
  id: string
  invoice_number?: string
  total_amount: number
}

interface MarkPaidDialogProps {
  invoice: MarkPaidInvoice
  onSuccess?: () => void
  children: React.ReactNode
}

function todayYMD(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function MarkPaidDialog({ invoice, onSuccess, children }: MarkPaidDialogProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [paidDate, setPaidDate] = useState(todayYMD())
  const [paidAmount, setPaidAmount] = useState<string>(
    String(invoice.total_amount ?? '')
  )
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('check')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [notes, setNotes] = useState('')

  // Reset form whenever the dialog opens (so reopening shows fresh defaults)
  useEffect(() => {
    if (open) {
      setPaidDate(todayYMD())
      setPaidAmount(String(invoice.total_amount ?? ''))
      setPaymentMethod('check')
      setReferenceNumber('')
      setNotes('')
    }
  }, [open, invoice.total_amount])

  const showReference = paymentMethod === 'check' || paymentMethod === 'wire'
  const referenceLabel = paymentMethod === 'check' ? 'Check #' : 'Wire reference'
  const referencePlaceholder =
    paymentMethod === 'check' ? 'e.g. 4521' : 'e.g. WIRE-2026-001'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const amount = Number(paidAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Paid amount must be greater than 0')
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
      toast.error('Please enter a valid payment date')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/mark-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paid_date: paidDate,
          paid_amount: amount,
          payment_method: paymentMethod,
          reference_number: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to mark invoice paid')
      }

      const status = data?.invoice?.status as string | undefined
      const label =
        status === 'partially_paid' ? 'partially paid' : 'paid in full'
      toast.success(
        `Invoice ${invoice.invoice_number || ''} marked ${label}`.trim()
      )

      setOpen(false)
      onSuccess?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <span
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className="inline-flex"
      >
        {children}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Mark invoice paid
            </DialogTitle>
            <DialogDescription>
              {invoice.invoice_number ? (
                <>
                  Record a payment for invoice{' '}
                  <span className="font-mono font-medium">
                    {invoice.invoice_number}
                  </span>
                  .
                </>
              ) : (
                'Record a payment for this invoice.'
              )}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit}
            id="mark-paid-form"
            className="contents"
          >
            <DialogBody className="space-y-4">
              {/* Payment date + amount as a pair */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="paid_date" required>
                    Payment date
                  </Label>
                  <Input
                    id="paid_date"
                    type="date"
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="paid_amount" required>
                    Amount paid
                  </Label>
                  <Input
                    id="paid_amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Invoice total:{' '}
                <span className="font-medium text-foreground">
                  ${invoice.total_amount.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                  })}
                </span>
                . If less than the total, the invoice will be marked partially paid.
              </p>

              {/* Payment method */}
              <div className="space-y-1.5">
                <Label htmlFor="payment_method" required>
                  Payment method
                </Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                >
                  <SelectTrigger id="payment_method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reference number — only for check/wire */}
              {showReference && (
                <div className="space-y-1.5">
                  <Label htmlFor="reference_number">{referenceLabel}</Label>
                  <Input
                    id="reference_number"
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder={referencePlaceholder}
                  />
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything else worth noting about this payment…"
                  rows={3}
                />
              </div>
            </DialogBody>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Mark paid
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
