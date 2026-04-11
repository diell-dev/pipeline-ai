'use client'

import { Card, CardContent } from '@/components/ui/card'
import { FileText } from 'lucide-react'

export default function InvoicesPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground">
          Track invoices, payment status, and outstanding balances.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Invoices are automatically generated when jobs are approved. They&apos;ll appear here once you start processing jobs.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
