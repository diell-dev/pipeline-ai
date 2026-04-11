'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Building2, Plus } from 'lucide-react'
import { hasPermission } from '@/lib/permissions'

export default function ClientsPage() {
  const { user } = useAuthStore()
  const canCreate = user?.role ? hasPermission(user.role, 'clients:create') : false

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">
            Manage your client accounts, contacts, and billing details.
          </p>
        </div>
        {canCreate && (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Client
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-1">No clients yet</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Add your first client to start managing their sites, jobs, and invoices.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
