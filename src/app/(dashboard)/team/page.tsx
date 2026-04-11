'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Users, UserPlus } from 'lucide-react'
import { hasPermission } from '@/lib/permissions'

export default function TeamPage() {
  const { user } = useAuthStore()
  const canInvite = user?.role ? hasPermission(user.role, 'users:invite') : false

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            Manage team members, roles, and access permissions.
          </p>
        </div>
        {canInvite && (
          <Button>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Team management coming soon</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            You&apos;ll be able to invite field technicians, office managers, and manage their permissions here.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
