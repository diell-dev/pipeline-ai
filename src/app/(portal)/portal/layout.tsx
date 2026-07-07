'use client'

/**
 * Client portal shell.
 *
 * Role-guarded: only role='client' logins belong here (staff are bounced to
 * the dashboard). RLS is the real boundary — this guard is UX. Wraps content
 * in BrandProvider so the client sees the org's branding.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { BrandProvider } from '@/components/providers/brand-provider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LogOut } from 'lucide-react'
import { PortalTabs, PortalBottomNav } from '@/components/portal/portal-nav'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, user, organization, clearSession } = useAuthStore()
  const router = useRouter()

  // Staff never belong in the client portal.
  useEffect(() => {
    if (!isLoading && user && user.role !== 'client') router.replace('/dashboard')
  }, [isLoading, user, router])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    clearSession()
    router.replace('/login')
  }

  if (isLoading || !user) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <BrandProvider>
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur dark:bg-zinc-900/90">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              {organization?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={organization.logo_url} alt="" className="h-7 w-7 rounded object-contain" />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-primary">
                  {organization?.name ?? 'Client Portal'}
                </p>
                <p className="truncate text-xs text-muted-foreground">Client Portal</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PortalTabs />
              <Button variant="ghost" size="sm" onClick={signOut} className="h-9">
                <LogOut className="mr-1.5 h-4 w-4" /> Sign out
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6 pb-24">{children}</main>
        <PortalBottomNav />
      </div>
    </BrandProvider>
  )
}
