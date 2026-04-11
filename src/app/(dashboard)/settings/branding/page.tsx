'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Palette } from 'lucide-react'

export default function BrandingSettingsPage() {
  const { organization, theme } = useAuthStore()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Branding</h1>
        <p className="text-muted-foreground">
          Customize your organization&apos;s look and feel.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Brand Colors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Primary</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-10 w-10 rounded-lg border"
                  style={{ backgroundColor: theme.primaryColor }}
                />
                <span className="text-sm text-muted-foreground">{theme.primaryColor}</span>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Accent</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-10 w-10 rounded-lg border"
                  style={{ backgroundColor: theme.accentColor }}
                />
                <span className="text-sm text-muted-foreground">{theme.accentColor}</span>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Secondary</p>
              <div className="flex items-center gap-2">
                <div
                  className="h-10 w-10 rounded-lg border"
                  style={{ backgroundColor: theme.secondaryColor }}
                />
                <span className="text-sm text-muted-foreground">{theme.secondaryColor}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Palette className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <h3 className="text-base font-semibold mb-1">Brand customization coming soon</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            You&apos;ll be able to upload your logo, change colors, and customize the look of reports and invoices.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
