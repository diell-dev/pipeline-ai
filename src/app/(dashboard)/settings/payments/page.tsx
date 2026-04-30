'use client'

/**
 * Payments Settings — Stripe Connect
 *
 * Owner-only page that manages this org's connection to Stripe.
 *  - Not connected: explainer + "Connect Stripe Account" button.
 *  - Connected:     status, capability flags, refresh + disconnect buttons.
 *
 * On return from Stripe-hosted onboarding (?return=1) we automatically
 * call refresh-status to pull the latest capability flags.
 */
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'

interface StripeOrgState {
  stripe_account_id: string | null
  stripe_account_status: 'pending' | 'active' | 'restricted' | 'disconnected' | null
  stripe_charges_enabled: boolean
  stripe_payouts_enabled: boolean
}

export default function PaymentsSettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, organization } = useAuthStore()
  const canManage =
    user?.role === 'owner' ||
    user?.role === 'super_admin' ||
    (user?.role ? hasPermission(user.role, 'settings:manage') : false)

  const [state, setState] = useState<StripeOrgState | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Load org state
  useEffect(() => {
    async function load() {
      if (!organization?.id) return
      const supabase = createClient()
      const { data } = await supabase
        .from('organizations')
        .select(
          'stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled'
        )
        .eq('id', organization.id)
        .single()

      if (data) {
        setState({
          stripe_account_id: data.stripe_account_id,
          stripe_account_status: data.stripe_account_status,
          stripe_charges_enabled: !!data.stripe_charges_enabled,
          stripe_payouts_enabled: !!data.stripe_payouts_enabled,
        })
      }
      setLoading(false)
    }
    load()
  }, [organization?.id])

  // Auto-refresh status if returning from Stripe onboarding
  useEffect(() => {
    if (!searchParams) return
    if (searchParams.get('return') === '1') {
      handleRefresh(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function handleConnect() {
    setConnecting(true)
    try {
      const res = await fetch('/api/stripe/connect/start', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to start Stripe Connect')
        return
      }
      window.location.href = data.url
    } catch {
      toast.error('Failed to start Stripe Connect')
    } finally {
      setConnecting(false)
    }
  }

  async function handleRefresh(silent = false) {
    setRefreshing(true)
    try {
      const res = await fetch('/api/stripe/connect/refresh-status', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        if (!silent) toast.error(data.error || 'Failed to refresh')
        return
      }
      const org = data.organization
      setState({
        stripe_account_id: org.stripe_account_id,
        stripe_account_status: org.stripe_account_status,
        stripe_charges_enabled: !!org.stripe_charges_enabled,
        stripe_payouts_enabled: !!org.stripe_payouts_enabled,
      })
      if (!silent) toast.success('Status refreshed')
    } catch {
      if (!silent) toast.error('Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        'Disconnect this Stripe account? Card payments will stop working until you reconnect.'
      )
    ) {
      return
    }
    setDisconnecting(true)
    try {
      const res = await fetch('/api/stripe/connect/disconnect', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to disconnect')
        return
      }
      setState({
        stripe_account_id: null,
        stripe_account_status: 'disconnected',
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
      })
      toast.success('Stripe disconnected')
    } catch {
      toast.error('Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <h3 className="text-lg font-semibold">Access Restricted</h3>
            <p className="text-sm text-muted-foreground">
              Only owners can manage payment settings.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const connected = !!state?.stripe_account_id

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground text-sm">
            Accept credit-card invoice payments via Stripe.
          </p>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : !connected ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Connect Stripe to accept card payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              When connected, every invoice email will include a &ldquo;Pay with
              Card&rdquo; button. Payments are deposited directly into your
              Stripe account &mdash; we never hold your money. You&apos;ll be
              redirected to Stripe to complete a short verification.
            </p>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Redirecting&hellip;
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect Stripe Account
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Stripe Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <StatusRow
                label="Account status"
                badge={<StatusBadge status={state?.stripe_account_status} />}
              />
              <StatusRow
                label="Card charges"
                badge={<EnabledBadge enabled={state?.stripe_charges_enabled} />}
              />
              <StatusRow
                label="Payouts to bank"
                badge={<EnabledBadge enabled={state?.stripe_payouts_enabled} />}
              />
              <StatusRow
                label="Account ID"
                badge={
                  <code className="text-xs bg-zinc-100 px-2 py-0.5 rounded">
                    {state?.stripe_account_id}
                  </code>
                }
              />
            </div>

            {state?.stripe_account_status === 'pending' && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
                Onboarding isn&apos;t finished. Click Connect again to resume,
                then Refresh to update status here.
              </div>
            )}
            {state?.stripe_account_status === 'restricted' && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
                Stripe needs more information. Re-open onboarding from Stripe
                or contact support.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                {state?.stripe_charges_enabled ? 'Manage on Stripe' : 'Resume onboarding'}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleRefresh(false)}
                disabled={refreshing}
              >
                {refreshing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Refresh status
              </Button>
              <Button
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatusRow({
  label,
  badge,
}: {
  label: string
  badge: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {badge}
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: StripeOrgState['stripe_account_status']
}) {
  if (status === 'active') {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Active
      </Badge>
    )
  }
  if (status === 'restricted') {
    return <Badge className="bg-red-100 text-red-700 border-red-200">Restricted</Badge>
  }
  if (status === 'disconnected') {
    return <Badge className="bg-zinc-100 text-zinc-700">Disconnected</Badge>
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 border-amber-200">
      Pending verification
    </Badge>
  )
}

function EnabledBadge({ enabled }: { enabled: boolean | undefined }) {
  return enabled ? (
    <Badge className="bg-green-100 text-green-700 border-green-200">Enabled</Badge>
  ) : (
    <Badge className="bg-zinc-100 text-zinc-700">Disabled</Badge>
  )
}
