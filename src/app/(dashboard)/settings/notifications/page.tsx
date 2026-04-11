'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Bell } from 'lucide-react'

export default function NotificationsSettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground">
          Configure how and when you receive notifications.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Bell className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">Notifications coming soon</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            You&apos;ll be able to configure email notifications for job submissions, approvals, payments, and more.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
