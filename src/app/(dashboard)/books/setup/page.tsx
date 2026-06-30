'use client'

/**
 * Books setup wizard.
 *
 * Three guided steps:
 *   1. Confirm fiscal year (display-only — January default).
 *   2. Seed default chart of accounts (the 38 system accounts from
 *      migration 015).
 *   3. Create the first accounting period (the current month).
 *
 * On Finish, POSTs /api/books/setup which does steps 2+3 atomically and
 * stamps `organizations.books_enabled_at`. Then we refresh the auth store
 * (so the dashboard knows books are live) and route to /books.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { monthsList } from '@/lib/books/wizard-helpers'

const STEPS = ['Fiscal year', 'Chart of accounts', 'First period'] as const

export default function BooksSetupPage() {
  const router = useRouter()
  const { refreshOrganization, organization } = useAuthStore()

  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [fiscalStart, setFiscalStart] = useState(1) // 1=Jan
  const [periodName, setPeriodName] = useState(
    new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })
  )

  async function handleFinish() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/books/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fiscalYearStartMonth: fiscalStart, periodName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      toast.success(
        `Books enabled. ${data.accountsSeeded ?? 0} accounts seeded.`
      )
      await refreshOrganization()
      // One-time hint flag — the dashboard reads this and shows a
      // "what's next" banner pointing to /books/invoices/new. Cleared
      // by the dashboard on dismiss or first invoice creation.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('books-just-setup', '1')
        }
      } catch {
        // localStorage can throw in privacy-mode browsers; ignore.
      }
      router.replace('/books')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Setup failed'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // If books already enabled, bounce back.
  if (organization?.books_enabled_at) {
    router.replace('/books')
    return null
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Books setup" subtitle="Three quick steps and you're posting entries." />

      {/* Stepper */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step
          const active = i === step
          return (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span className={[
                'inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                done ? 'bg-brand-primary text-white'
                  : active ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={active ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 text-muted-foreground/40">›</span>}
            </li>
          )
        })}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pick the month your fiscal year begins. Most US small businesses
                use January. You can change this later in Books › Settings.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="fiscal-start">Fiscal year starts in</Label>
                <select
                  id="fiscal-start"
                  value={fiscalStart}
                  onChange={(e) => setFiscalStart(Number(e.target.value))}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                >
                  {monthsList().map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                We&rsquo;ll seed the standard US small-business chart of accounts —
                38 accounts covering assets, liabilities, equity, income, and
                expenses. You can rename, add, or deactivate any non-system
                account later.
              </p>
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                <li>Cash, bank, accounts receivable</li>
                <li>Accounts payable, sales tax, credit card payable</li>
                <li>Owner&rsquo;s equity, retained earnings</li>
                <li>Service revenue, product sales</li>
                <li>COGS, materials, subcontractors</li>
                <li>Operating expenses (rent, utilities, fuel, marketing&hellip;)</li>
              </ul>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Accounting periods are the calendar fences for the books. We&rsquo;ll
                create one for the current month — every posted entry will land
                in it until you close the month and open a new one.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="period-name">First period name</Label>
                <Input
                  id="period-name"
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  placeholder="e.g. June 2026"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={submitting}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Setting up&hellip;</>
            ) : (
              <>Finish setup <Check className="ml-1 h-4 w-4" /></>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
