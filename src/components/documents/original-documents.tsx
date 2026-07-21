'use client'

/**
 * Renders the archived original of a historical document — the exact wording
 * the client received.
 *
 * These reports are the record of what was communicated, so the text is shown
 * verbatim from `imported_documents` and is never re-flowed, summarised or
 * re-generated. Presentation (fonts, spacing, letterhead) may change freely;
 * the words may not. Printing uses the same stored text.
 */

import { useEffect, useState } from 'react'
import { FileText, Printer, ChevronDown, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export interface OriginalDoc {
  id: string
  doc_type: 'report' | 'invoice' | 'proposal'
  source_file: string
  verbatim_text: string
  document_date: string | null
  char_count: number
}

const LABEL: Record<OriginalDoc['doc_type'], string> = {
  report: 'Service report',
  invoice: 'Invoice',
  proposal: 'Proposal',
}

export function useOriginalDocuments(jobId?: string, invoiceId?: string) {
  const [docs, setDocs] = useState<OriginalDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!jobId && !invoiceId) {
        setLoading(false)
        return
      }
      const supabase = createClient()
      let q = supabase
        .from('imported_documents')
        .select('id, doc_type, source_file, verbatim_text, document_date, char_count')
        .order('doc_type')
      q = jobId ? q.eq('job_id', jobId) : q.eq('invoice_id', invoiceId!)
      const { data } = await q
      if (!cancelled) {
        setDocs((data as OriginalDoc[]) ?? [])
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jobId, invoiceId])

  return { docs, loading }
}

function printDocument(doc: OriginalDoc) {
  const w = window.open('', '_blank', 'width=850,height=1000')
  if (!w) return
  const escaped = doc.verbatim_text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  w.document.write(`<!doctype html><html><head><title>${LABEL[doc.doc_type]}</title>
<style>
  @page { margin: 18mm; }
  body { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
         font-size: 11.5px; line-height: 1.45; color: #111; }
  pre  { white-space: pre-wrap; word-wrap: break-word; margin: 0; font: inherit; }
</style></head><body><pre>${escaped}</pre></body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250)
}

export function OriginalDocuments({
  jobId,
  invoiceId,
  defaultOpen = false,
}: {
  jobId?: string
  invoiceId?: string
  defaultOpen?: boolean
}) {
  const { docs, loading } = useOriginalDocuments(jobId, invoiceId)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (loading || docs.length === 0) return null

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Original document{docs.length > 1 ? 's' : ''} as sent
          </h2>
          <Badge variant="secondary" className="text-[10px]">archived</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          The exact wording delivered to the client. Kept unchanged for reprinting.
        </p>

        {docs.map((d) => {
          const isOpen = open[d.id] ?? defaultOpen
          return (
            <div key={d.id} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 p-2.5">
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [d.id]: !isOpen }))}
                  className="flex min-w-0 items-center gap-1.5 text-left text-sm font-medium hover:underline"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{LABEL[d.doc_type]}</span>
                </button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => printDocument(d)}
                  className="shrink-0 gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
              </div>
              {isOpen && (
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words border-t bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                  {d.verbatim_text}
                </pre>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
