'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Settings, Palette, Bell, Shield, Building, Mail, FileText, CreditCard, Users, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { hasPermission, type Permission } from '@/lib/permissions'

// UX-SWEEP-#8: Added Team + Subscription cards so org admins can find people
// management and (eventually) billing here, where they expect them. Team
// still lives at /team for direct access from the sidebar; this is just a
// linked entry point from Settings.
type SettingSection = {
  title: string
  description: string
  icon: typeof Settings
  href?: string
  onClick?: 'subscription-stub'
  permission?: Permission
  badge?: string
}

const settingSections: SettingSection[] = [
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
    permission: 'settings:manage',
  },
  {
    title: 'Team',
    description: 'Manage team members, invite teammates, and assign roles.',
    icon: Users,
    href: '/team',
    permission: 'users:view',
  },
  {
    title: 'Email Integration',
    description: 'Configure how reports and invoices are emailed to clients.',
    icon: Mail,
    href: '/settings/email',
    permission: 'settings:manage',
  },
  {
    title: 'Payments',
    description: 'Connect Stripe to accept credit-card invoice payments.',
    icon: CreditCard,
    href: '/settings/payments',
    permission: 'settings:manage',
  },
  {
    title: 'Subscription',
    description: 'View your plan and billing details.',
    icon: Sparkles,
    onClick: 'subscription-stub',
    permission: 'settings:manage',
    badge: 'Coming soon',
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
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and organization preferences.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {visibleSections.map((section) => {
          const Icon = section.icon
          const cardInner = (
            <Card className="hover:border-zinc-300 transition-colors cursor-pointer h-full min-h-[88px] dark:hover:border-zinc-600">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {section.title}
                    {section.badge && (
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {section.badge}
                      </Badge>
                    )}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {section.description}
                </p>
              </CardContent>
            </Card>
          )

          // UX-SWEEP-#8: subscription card is a stub — show a toast until
          // self-serve billing ships, instead of routing to a 404.
          if (section.onClick === 'subscription-stub') {
            return (
              <button
                key={section.title}
                type="button"
                onClick={() =>
                  toast.info('Self-serve subscription management is coming soon.')
                }
                className="block h-full text-left"
              >
                {cardInner}
              </button>
            )
          }

          return (
            <Link
              key={section.href}
              href={section.href!}
              className="block h-full"
            >
              {cardInner}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
