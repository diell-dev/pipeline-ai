'use client'

/**
 * Books → New payment redirect helper.
 *
 * In practice payments always apply against a specific invoice or bill,
 * so the recording UI lives on those detail pages (the dialog has the
 * right defaults — balance due, vendor / client, etc.). This page just
 * points users in the right direction rather than asking them to type a
 * source id by hand.
 */
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FileText, ReceiptText } from 'lucide-react'

export default function NewPaymentPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Record payment"
        subtitle="Payments are always tied to either an invoice or a bill. Pick the source first."
      />

      <Card>
        <CardContent className="grid sm:grid-cols-2 gap-3 pt-4">
          <Link href="/books/invoices">
            <Button variant="outline" className="w-full justify-start h-auto py-4">
              <FileText className="mr-3 h-5 w-5" />
              <span className="flex flex-col items-start text-left">
                <span className="font-medium">Pay against an invoice</span>
                <span className="text-xs text-muted-foreground">Customer paid us.</span>
              </span>
            </Button>
          </Link>
          <Link href="/books/bills">
            <Button variant="outline" className="w-full justify-start h-auto py-4">
              <ReceiptText className="mr-3 h-5 w-5" />
              <span className="flex flex-col items-start text-left">
                <span className="font-medium">Pay a vendor bill</span>
                <span className="text-xs text-muted-foreground">We paid the vendor.</span>
              </span>
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
