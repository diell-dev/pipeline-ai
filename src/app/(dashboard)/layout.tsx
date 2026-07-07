'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppHeader } from '@/components/layout/app-header'
import { BottomNav } from '@/components/layout/bottom-nav'
import { MobilePageTransition } from '@/components/layout/mobile-page-transition'
import { BrandProvider } from '@/components/providers/brand-provider'
import { Skeleton } from '@/components/ui/skeleton'
import { InstallPrompt } from '@/components/install-prompt'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isLoading, user } = useAuthStore()
  const router = useRouter()
  // Phase F: re-key the <main> on pathname so the page-fade-in keyframe
  // replays on every route change. No layout shift — purely opacity + 4px
  // translateY. Reduced-motion users get the final state instantly.
  //
  // M2.3: On mobile, the richer MobilePageTransition wrapper handles
  // push / pop / tab-switch transitions. Desktop keeps the cheap CSS
  // keyframe (`md:page-fade-in`) — mobile uses motion/react and lets the
  // CSS class no-op via the `md:` prefix.
  const pathname = usePathname()

  // Client-portal logins never belong in the staff dashboard.
  useEffect(() => {
    if (!isLoading && user?.role === 'client') router.replace('/portal')
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Skeleton className="w-64 h-full" />
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-48 mb-6" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  return (
    <BrandProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar: hidden on mobile (bottom nav replaces it) */}
        <div className="hidden md:flex md:flex-shrink-0">
          <AppSidebar />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main
            key={pathname}
            className="md:page-fade-in flex-1 overflow-y-auto bg-zinc-50 pb-20 md:pb-0 dark:bg-zinc-950"
          >
            <MobilePageTransition>{children}</MobilePageTransition>
          </main>
        </div>
      </div>
      {/* Mobile bottom nav */}
      <BottomNav />
      {/* M4.4 — PWA install nudge. Self-throttles (60s dwell, 3+ routes,
          30d dismissal). Renders nothing outside its eligibility window. */}
      <InstallPrompt />
    </BrandProvider>
  )
}
