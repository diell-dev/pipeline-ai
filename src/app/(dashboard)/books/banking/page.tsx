'use client'

/**
 * Books → Banking. Bank reconciliation lives here once B5 ships the
 * Plaid + CSV import wiring. For this pass we render an EmptyState that
 * points to manual payments + the chart-of-accounts cash balances.
 */
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Banknote } from 'lucide-react'

export default function BankingPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Banking" subtitle="Match bank transactions to invoices and bills." />
      <EmptyState
        icon={Banknote}
        title="Bank reconciliation coming soon"
        description="Plaid sync, CSV import, and the match-to-payment workflow ship in the next bookkeeping pass. Until then, payments recorded against invoices and bills land in the deposit account you pick — that&rsquo;s where the reconciliation will hang."
      />
    </div>
  )
}
