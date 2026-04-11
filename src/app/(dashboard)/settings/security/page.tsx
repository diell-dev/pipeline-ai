'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Shield } from 'lucide-react'

export default function SecuritySettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground">
          Manage your password and security settings.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Security settings coming soon</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            You&apos;ll be able to change your password, enable two-factor authentication, and manage active sessions.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
