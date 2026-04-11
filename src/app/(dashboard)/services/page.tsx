'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Wrench, Plus } from 'lucide-react'
import { hasPermission } from '@/lib/permissions'

export default function ServicesPage() {
  const { user } = useAuthStore()
  const canManage = user?.role ? hasPermission(user.role, 'services:manage') : false

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground">
            Define your services, pricing, and units for invoicing.
          </p>
        </div>
        {canManage && (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Service
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Wrench className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No services defined</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Set up your service catalog with standard pricing. These will be used when creating jobs and generating invoices.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
