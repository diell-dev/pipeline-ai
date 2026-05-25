'use client'

import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppHeader } from '@/components/layout/app-header'
import { BottomNav } from '@/components/layout/bottom-nav'
import { BrandProvider } from '@/components/providers/brand-provider'
import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isLoading } = useAuthStore()
  // Phase F: re-key the <main> on pathname so the page-fade-in keyframe
  // replays on every route change. No layout shift — purely opacity + 4px
  // translateY. Reduced-motion users get the final state instantly.
  const pathname = usePathname()

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
            className="page-fade-in flex-1 overflow-y-auto bg-zinc-50 pb-20 md:pb-0"
          >
            {children}
          </main>
        </div>
      </div>
      {/* Mobile bottom nav */}
      <BottomNav />
    </BrandProvider>
  )
}
