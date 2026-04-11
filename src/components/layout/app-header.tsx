'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { getRoleLabel } from '@/lib/permissions'
import { getTierConfig } from '@/lib/tier-limits'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Bell, LogOut, User, Settings } from 'lucide-react'
import { toast } from 'sonner'

export function AppHeader() {
  const router = useRouter()
  const { user, organization } = useAuthStore()

  async function handleSignOut() {
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      toast.success('Signed out')
      router.push('/login')
      router.refresh()
    } catch {
      toast.error('Failed to sign out. Please try again.')
    }
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-6">
      {/* Left: breadcrumb area (will be dynamic per page) */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {organization?.tier ? getTierConfig(organization.tier).label : ''}
        </Badge>
      </div>

      {/* Right: notifications + user menu */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {/* Notification badge — will be dynamic */}
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 transition-colors outline-none">
            <div className="h-7 w-7 rounded-full bg-zinc-200 flex items-center justify-center text-xs font-medium">
              {user?.full_name?.charAt(0) || '?'}
            </div>
            <span className="text-sm font-medium hidden sm:inline">
              {user?.full_name}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.full_name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {user?.role ? getRoleLabel(user.role) : ''}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/settings/profile')}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} variant="destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
