'use client'

/** More — secondary portal destinations. */
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { CalendarClock, FileSignature, FolderOpen, Wrench, ChevronRight } from 'lucide-react'

const LINKS = [
  { href: '/portal/visits', label: 'Upcoming visits', desc: 'When we’re next scheduled', icon: CalendarClock },
  { href: '/portal/proposals', label: 'Proposals', desc: 'Review and approve estimates', icon: FileSignature },
  { href: '/portal/documents', label: 'Documents', desc: 'Download reports and invoices', icon: FolderOpen },
  { href: '/portal/request', label: 'Request service', desc: 'Ask us for more work', icon: Wrench },
]

export default function PortalMorePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">More</h1>
      <div className="space-y-2">
        {LINKS.map(({ href, label, desc, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
