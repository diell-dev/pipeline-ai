'use client'

/**
 * ReportToolbar — shared date controls + export/print buttons for every
 * report page. Two modes:
 *   - "range" (default): from + to date inputs.
 *   - "asOf": single as-of date.
 *
 * The Export-PDF button is a stub that toasts "coming soon"; CSV and
 * Print are wired. Each report page passes a `getCsvRows` callback that
 * builds the rows lazily so we don't materialize CSV for every render.
 */
import { useCallback } from 'react'
import { Download, FileText, Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { downloadCsv } from '@/lib/books/csv-export'
import { toast } from 'sonner'

interface CommonProps {
  /** Builds the CSV rows on demand. Return [] to disable export. */
  getCsvRows?: () => ReadonlyArray<ReadonlyArray<unknown>>
  /** Filename for the CSV (no extension). */
  csvFilename?: string
  /** Disable everything while the report is loading. */
  loading?: boolean
}

type ReportToolbarProps =
  | (CommonProps & {
      mode: 'range'
      startDate: string
      endDate: string
      onStartDateChange: (s: string) => void
      onEndDateChange: (s: string) => void
    })
  | (CommonProps & {
      mode: 'asOf'
      asOfDate: string
      onAsOfDateChange: (s: string) => void
    })

export function ReportToolbar(props: ReportToolbarProps) {
  const { getCsvRows, csvFilename = 'report', loading } = props

  const handleCsv = useCallback(() => {
    if (!getCsvRows) return
    const rows = getCsvRows()
    if (!rows.length) {
      toast.error('No data to export.')
      return
    }
    downloadCsv(rows, csvFilename)
  }, [getCsvRows, csvFilename])

  const handlePdf = useCallback(() => {
    // PDF rendering stub. TODO: wire into jspdf-autotable per report so
    // the exported PDF mirrors the on-screen layout (same as B3's
    // invoice PDF generation in lib/pdf).
    toast.message('PDF export', {
      description: 'PDF export is coming soon — use Print for now.',
    })
  }, [])

  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return
    window.print()
  }, [])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        {props.mode === 'range' ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="report-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="report-from"
                type="date"
                value={props.startDate}
                onChange={(e) => props.onStartDateChange(e.target.value)}
                className="h-9 w-[150px] text-sm"
                disabled={loading}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="report-to"
                type="date"
                value={props.endDate}
                onChange={(e) => props.onEndDateChange(e.target.value)}
                className="h-9 w-[150px] text-sm"
                disabled={loading}
              />
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="report-asof" className="text-xs text-muted-foreground">
              As of
            </Label>
            <Input
              id="report-asof"
              type="date"
              value={props.asOfDate}
              onChange={(e) => props.onAsOfDateChange(e.target.value)}
              className="h-9 w-[150px] text-sm"
              disabled={loading}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {getCsvRows && (
          <Button variant="outline" size="sm" onClick={handleCsv} disabled={loading}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export CSV
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handlePdf} disabled={loading}>
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          Export PDF
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={loading}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print
        </Button>
      </div>
    </div>
  )
}
