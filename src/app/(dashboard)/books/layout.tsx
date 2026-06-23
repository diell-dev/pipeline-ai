'use client'

/**
 * Books module layout shell.
 *
 * Two guards before any sub-page renders:
 *   1. The org's subscription tier must include `bookkeeping`. Business
 *      tier today; non-business orgs get redirected back to /dashboard.
 *   2. The user must hold the `bookkeeping:view` permission. Field techs
 *      and clients are out; owners + office_managers + super_admins are in.
 *
 * Inside the shell, BooksSubNav renders as a horizontal pill bar on
 * mobile and a left rail on desktop, so the many books pages don't
 * crowd the global app sidebar.
 */
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { hasFeature } from '@/lib/tier-limits'
import { BooksSubNav } from '@/components/books/books-subnav'
import { Skeleton } from '@/components/ui/skeleton'

export default function BooksLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, organization, isLoading } = useAuthStore()

  const canView = user?.role ? hasPermission(user.role, 'bookkeeping:view') : false
  const tierAllows = organization ? hasFeature(organization.tier, 'bookkeeping') : false

  useEffect(() => {
    if (isLoading) return
    if (!user || !organization) return
    if (!canView || !tierAllows) {
      router.replace('/dashboard')
    }
  }, [isLoading, user, organization, canView, tierAllows, router])

  if (isLoading || !user || !organization) {
    return (
      <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!canView || !tierAllows) {
    // Effect fires the redirect; meanwhile show a tiny placeholder so
    // the page doesn't flash any books content.
    return (
      <div className="p-6 text-sm text-muted-foreground">Redirecting…</div>
    )
  }

  // The /books/reports section ships its own layout (left-rail of report
  // links + section padding). To avoid double sub-nav and double padding,
  // we render bare children for that subtree and let its layout handle
  // the chrome.
  const isReportsSection = pathname?.startsWith('/books/reports') ?? false
  if (isReportsSection) {
    return <>{children}</>
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="lg:flex lg:gap-6">
        <BooksSubNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
