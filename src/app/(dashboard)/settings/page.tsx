'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings, Palette, Bell, Shield, Building, Mail, FileText, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { hasPermission } from '@/lib/permissions'

const settingSections = [
  {
    title: 'Profile',
    description: 'Update your name, email, and personal preferences.',
    icon: Settings,
    href: '/settings/profile',
  },
  {
    title: 'Company Profile',
    description: 'Logo, colors, contact info, invoice themes, and document headers/footers.',
    icon: Building,
    href: '/settings/company-profile',
    permission: 'settings:manage' as const,
  },
  {
    title: 'Email Integration',
    description: 'Configure how reports and invoices are emailed to clients.',
    icon: Mail,
    href: '/settings/email',
    permission: 'settings:manage' as const,
  },
  {
    title: 'Payments',
    description: 'Connect Stripe to accept credit-card invoice payments.',
    icon: CreditCard,
    href: '/settings/payments',
    permission: 'settings:manage' as const,
  },
  {
    title: 'Notifications',
    description: 'Configure email and in-app notification preferences.',
    icon: Bell,
    href: '/settings/notifications',
  },
  {
    title: 'Security',
    description: 'Password, two-factor authentication, and sessions.',
    icon: Shield,
    href: '/settings/security',
  },
]

export default function SettingsPage() {
  const { user } = useAuthStore()

  const visibleSections = settingSections.filter((section) => {
    if (!section.permission) return true
    if (!user?.role) return false
    return hasPermission(user.role, section.permission)
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and organization preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleSections.map((section) => {
          const Icon = section.icon
          return (
            <Link key={section.href} href={section.href}>
              <Card className="hover:border-zinc-300 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100">
                      <Icon className="h-5 w-5 text-zinc-600" />
                    </div>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {section.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
