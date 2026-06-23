'use client'

/**
 * ReportPageGuard
 *
 * Wraps every report page to enforce two checks before rendering the
 * report:
 *   1. Tier gate — only Business-tier orgs can read the books reports.
 *      Anything below redirects to /upgrade.
 *   2. Permission gate — caller must hold `bookkeeping:reports`.
 *      Without it: 'Access denied' empty state (no redirect, so the
 *      user can navigate away without bouncing).
 *
 * Both checks happen inside an effect so SSR doesn't double-fire them.
 * While the auth store is still loading we render a skeleton so the
 * page doesn't briefly flash the redirect state.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { hasFeature } from '@/lib/tier-limits'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

interface ReportPageGuardProps {
  children: React.ReactNode
  /** Permission required to view the report (defaults to bookkeeping:reports). */
  permission?: Permission
}

export function ReportPageGuard({
  children,
  permission = 'bookkeeping:reports',
}: ReportPageGuardProps) {
  const router = useRouter()
  const { user, organization, isLoading } = useAuthStore()

  const tier = organization?.tier
  const hasBookkeeping = tier ? hasFeature(tier, 'bookkeeping') : false
  const canViewReports = user?.role
    ? hasPermission(user.role, permission)
    : false

  // Tier redirect happens once we know the org is loaded AND lacks the
  // bookkeeping feature.
  useEffect(() => {
    if (isLoading) return
    if (!organization) return
    if (!hasBookkeeping) {
      router.replace('/upgrade')
    }
  }, [isLoading, organization, hasBookkeeping, router])

  if (isLoading || !user || !organization) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!hasBookkeeping) {
    // Render a skeleton while the redirect fires so we don't flash the
    // (empty) report shell at the user.
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!canViewReports) {
    return (
      <EmptyState
        icon={Lock}
        title="Reports access not granted"
        description="Your role does not include permission to view financial reports. Ask your owner or office manager to grant `bookkeeping:reports`."
        action={
          <Button variant="outline" onClick={() => router.push('/dashboard')}>
            Back to dashboard
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}
