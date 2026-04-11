'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export default function OrganizationSettingsPage() {
  const { organization } = useAuthStore()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organization</h1>
        <p className="text-muted-foreground">
          Company details and billing information.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Company Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Company Name</Label>
              <Input
                id="orgName"
                defaultValue={organization?.name || ''}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">URL Slug</Label>
              <Input
                id="slug"
                defaultValue={organization?.slug || ''}
                disabled
              />
            </div>
          </div>
          <div className="pt-4">
            <Button disabled>Save Changes</Button>
            <p className="text-xs text-muted-foreground mt-2">
              Organization editing will be available soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
