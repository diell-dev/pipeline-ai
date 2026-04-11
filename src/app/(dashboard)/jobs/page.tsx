'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ClipboardList, Plus } from 'lucide-react'

export default function JobsPage() {
  const { user } = useAuthStore()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground">
            Manage field service jobs, submissions, and approvals.
          </p>
        </div>
        {user?.role !== 'client' && (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Job
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <ClipboardList className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No jobs yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Jobs will appear here once field technicians submit their first service reports.
            Click &quot;New Job&quot; to create one manually.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
