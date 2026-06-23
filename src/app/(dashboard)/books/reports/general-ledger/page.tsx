'use client'

/**
 * General Ledger drill-down.
 *
 * Pick an account to see every posted line that touched it in the
 * window, with a running balance. Leave the picker blank to see every
 * line across all accounts (no running balance in that mode).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ScrollText } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getGeneralLedger,
  type GeneralLedgerReport,
} from '@/lib/books/reports'
import {
  centsToDollars,
  formatCurrency,
  formatDate,
  startOfYearIso,
  todayIso,
} from '@/lib/books/format'

import { ReportPageGuard } from '../_components/report-page-guard'
import { ReportToolbar } from '../_components/report-toolbar'

interface AccountOption {
  id: string
  code: string
  name: string
  type: string
}

export default function GeneralLedgerPage() {
  return (
    <ReportPageGuard>
      <GeneralLedgerInner />
    </ReportPageGuard>
  )
}

function GeneralLedgerInner() {
  const { organization } = useAuthStore()
  const [startDate, setStartDate] = useState<string>(startOfYearIso())
  const [endDate, setEndDate] = useState<string>(todayIso())
  const [accountId, setAccountId] = useState<string>('')
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [report, setReport] = useState<GeneralLedgerReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load accounts for the picker.
  useEffect(() => {
    if (!organization) return
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const { data, error: accErr } = await supabase
        .from('chart_of_accounts')
        .select('id, code, name, type')
        .eq('organization_id', organization.id)
        .is('deleted_at', null)
        .order('code', { ascending: true })
      if (cancelled) return
      if (accErr) {
        setAccounts([])
        return
      }
      setAccounts((data ?? []) as AccountOption[])
    })()
    return () => {
      cancelled = true
    }
  }, [organization])

  const load = useCallback(async () => {
    if (!organization) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const r = await getGeneralLedger(
        supabase,
        organization.id,
        startDate,
        endDate,
        accountId || null
      )
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load general ledger.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [organization, startDate, endDate, accountId])

  useEffect(() => {
    load()
  }, [load])

  const selectedAccount = accounts.find((a) => a.id === accountId)

  const csvRows = useMemo(
    () => () => {
      if (!report) return []
      const rows: (string | number)[][] = []
      rows.push([
        'General Ledger',
        `${report.startDate} to ${report.endDate}`,
        selectedAccount ? `${selectedAccount.code} ${selectedAccount.name}` : 'All accounts',
      ])
      rows.push([])
      const header: string[] = [
        'Date',
        'Entry #',
        'Description',
        'Account',
        'Debit',
        'Credit',
      ]
      if (selectedAccount) header.push('Running Balance')
      rows.push(header)
      for (const e of report.entries) {
        const row: (string | number)[] = [
          e.entry_date,
          e.entry_number,
          e.description ?? '',
          `${e.account_code} ${e.account_name}`,
          centsToDollars(e.debit_cents),
          centsToDollars(e.credit_cents),
        ]
        if (selectedAccount) row.push(centsToDollars(e.running_balance_cents))
        rows.push(row)
      }
      rows.push([
        'Totals',
        '',
        '',
        '',
        centsToDollars(report.totals.debits_cents),
        centsToDollars(report.totals.credits_cents),
        selectedAccount ? centsToDollars(report.closingBalance_cents) : '',
      ])
      return rows
    },
    [report, selectedAccount]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'Books', href: '/books' },
          { label: 'Reports', href: '/books/reports' },
          { label: 'General Ledger' },
        ]}
        title="General Ledger"
        subtitle="Every posted journal-entry line in the chosen window. Pick an account for a running balance."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <ReportToolbar
            mode="range"
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            loading={loading}
            getCsvRows={csvRows}
            csvFilename={`general_ledger_${startDate}_to_${endDate}${
              selectedAccount ? '_' + selectedAccount.code : ''
            }`}
          />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:gap-4 print:hidden">
          <div className="flex-1 space-y-1">
            <Label htmlFor="account-picker" className="text-xs text-muted-foreground">
              Filter by account
            </Label>
            <select
              id="account-picker"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>

          {selectedAccount && report && (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Opening balance</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(report.openingBalance_cents)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Period activity</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(report.totals.debits_cents)} dr /{' '}
                  {formatCurrency(report.totals.credits_cents)} cr
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Closing balance</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(report.closingBalance_cents)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {error ? (
        <EmptyState icon={AlertTriangle} title="Could not load report" description={error} />
      ) : loading ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : !report || report.entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No entries in this window"
          description={
            selectedAccount
              ? `No posted lines hit ${selectedAccount.code} ${selectedAccount.name} between ${startDate} and ${endDate}.`
              : 'No posted lines fall inside the chosen window. Try a wider range.'
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Entry #
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Description
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Account
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Debit
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Credit
                    </th>
                    {selectedAccount && (
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                        Balance
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {selectedAccount && (
                    <tr className="border-b bg-muted/20 italic text-muted-foreground">
                      <td className="px-4 py-2 text-sm" colSpan={4}>
                        Opening balance — {formatDate(report.startDate)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums" colSpan={2}>
                        —
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                        {formatCurrency(report.openingBalance_cents)}
                      </td>
                    </tr>
                  )}
                  {report.entries.map((e, i) => (
                    <tr
                      key={`${e.entry_id}-${i}`}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {formatDate(e.entry_date)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {e.entry_number}
                      </td>
                      <td className="px-4 py-2 text-sm">{e.description || '—'}</td>
                      <td className="px-4 py-2 text-sm">
                        <span className="text-muted-foreground">{e.account_code}</span>{' '}
                        {e.account_name}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(e.debit_cents, { showZeroAsDash: true })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {formatCurrency(e.credit_cents, { showZeroAsDash: true })}
                      </td>
                      {selectedAccount && (
                        <td className="px-4 py-2 text-right text-sm tabular-nums">
                          {formatCurrency(e.running_balance_cents)}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground/70 bg-muted/40 font-semibold">
                    <td className="px-4 py-2.5" colSpan={4}>
                      Totals
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.debits_cents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatCurrency(report.totals.credits_cents)}
                    </td>
                    {selectedAccount && (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCurrency(report.closingBalance_cents)}
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
