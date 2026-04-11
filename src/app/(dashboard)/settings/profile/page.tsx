'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { getRoleLabel } from '@/lib/permissions'

export default function ProfilePage() {
  const { user } = useAuthStore()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Your personal account information.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-16 w-16 rounded-full bg-zinc-200 flex items-center justify-center text-2xl font-semibold text-zinc-600">
              {user?.full_name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="font-medium text-lg">{user?.full_name}</p>
              <p className="text-sm text-muted-foreground">
                {user?.role ? getRoleLabel(user.role) : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                defaultValue={user?.full_name || ''}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                defaultValue={user?.email || ''}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                defaultValue={user?.phone || ''}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input
                id="role"
                defaultValue={user?.role ? getRoleLabel(user.role) : ''}
                disabled
              />
            </div>
          </div>

          <div className="pt-4">
            <Button disabled>
              Save Changes
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Profile editing will be available soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
