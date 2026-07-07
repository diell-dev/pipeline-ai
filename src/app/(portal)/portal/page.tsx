'use client'

/**
 * Portal home (Phase 0 placeholder).
 *
 * Confirms the portal loads for a client login and greets them with their
 * company name (their own `clients` row — RLS-scoped). The real overview
 * (outstanding balance, next visit, proposals awaiting approval) plus the
 * Service history / Invoices / Visits screens land in Phase 1.
 */
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { FileText, ReceiptText, CalendarClock } from 'lucide-react'

export default function PortalHome() {
  const { user } = useAuthStore()
  const [company, setCompany] = useState<string>('')

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('clients')
        .select('company_name')
        .eq('id', user.client_id as string)
        .maybeSingle<{ company_name: string }>()
      if (data?.company_name) setCompany(data.company_name)
    })()
  }, [user?.client_id])

  const soon = [
    { icon: ReceiptText, title: 'Invoices', desc: 'View and pay your invoices, download PDFs.' },
    { icon: FileText, title: 'Service history', desc: 'Past and upcoming work with reports and photos.' },
    { icon: CalendarClock, title: 'Upcoming visits', desc: 'When your next scheduled service is.' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Welcome{company ? `, ${company}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your portal is being set up. Soon you&apos;ll see all your work, invoices, and upcoming visits here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {soon.map(({ icon: Icon, title, desc }) => (
          <Card key={title} className="border-dashed">
            <CardContent className="p-4">
              <Icon className="h-5 w-5 text-brand-primary" />
              <p className="mt-2 font-medium text-foreground">{title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
              <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Coming soon
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
