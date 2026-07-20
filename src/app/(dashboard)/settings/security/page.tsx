'use client'

/**
 * Security Settings — audit S6 / G8.
 *
 * Replaces the "coming soon" stub with the two things that actually protect
 * an account holding a company's financials:
 *
 *   1. Change password — goes through /api/account/change-password, which
 *      re-authenticates with the current password, enforces strength rules,
 *      and clears the S8 forced-change state server-side.
 *   2. Two-factor authentication (TOTP) — Supabase's native MFA. Enrol scans
 *      a QR in any authenticator app; verification activates the factor.
 *
 * MFA is offered, not forced. Forcing it on a field tech's shared phone is a
 * good way to get locked out of a job site, so it's opt-in and surfaced most
 * prominently for owner / office_manager.
 */
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { KeyRound, Loader2, ShieldCheck, ShieldAlert, Smartphone, Trash2 } from 'lucide-react'

interface Factor {
  id: string
  friendly_name?: string
  status: string
}

export default function SecuritySettingsPage() {
  const { user } = useAuthStore()

  // ── Password ──
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  // ── MFA ──
  const [factors, setFactors] = useState<Factor[]>([])
  const [loadingFactors, setLoadingFactors] = useState(true)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollQr, setEnrollQr] = useState<string | null>(null)
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null)
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const verifiedFactors = factors.filter((f) => f.status === 'verified')
  const mfaEnabled = verifiedFactors.length > 0
  const isPrivileged = user?.role === 'owner' || user?.role === 'office_manager' || user?.role === 'super_admin'

  const loadFactors = useCallback(async () => {
    setLoadingFactors(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      setFactors(((data?.totp ?? []) as Factor[]) || [])
    } catch {
      // Non-fatal: the section just shows as unavailable.
      setFactors([])
    } finally {
      setLoadingFactors(false)
    }
  }, [])

  useEffect(() => {
    loadFactors()
  }, [loadFactors])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (newPassword.length < 12) {
      toast.error('Password must be at least 12 characters')
      return
    }

    setSavingPassword(true)
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not change password')

      toast.success('Password updated')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error('Could not change password', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSavingPassword(false)
    }
  }

  async function startEnroll() {
    setEnrolling(true)
    try {
      const supabase = createClient()

      // Clear out any half-finished unverified factor first — Supabase rejects
      // a second enrolment while one is pending.
      for (const stale of factors.filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id })
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator ${new Date().toLocaleDateString()}`,
      })
      if (error) throw error

      setEnrollFactorId(data.id)
      setEnrollQr(data.totp.qr_code)
      setEnrollSecret(data.totp.secret)
    } catch (err) {
      toast.error('Could not start two-factor setup', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setEnrolling(false)
    }
  }

  async function verifyEnroll(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollFactorId) return

    setVerifying(true)
    try {
      const supabase = createClient()
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: enrollFactorId,
      })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollFactorId,
        challengeId: challenge.id,
        code: totpCode.trim(),
      })
      if (verifyError) throw verifyError

      toast.success('Two-factor authentication is on')
      setEnrollQr(null)
      setEnrollSecret(null)
      setEnrollFactorId(null)
      setTotpCode('')
      await loadFactors()
    } catch (err) {
      toast.error('That code was not accepted', {
        description: err instanceof Error ? err.message : 'Check the 6-digit code and try again.',
      })
    } finally {
      setVerifying(false)
    }
  }

  async function cancelEnroll() {
    if (enrollFactorId) {
      const supabase = createClient()
      await supabase.auth.mfa.unenroll({ factorId: enrollFactorId })
    }
    setEnrollQr(null)
    setEnrollSecret(null)
    setEnrollFactorId(null)
    setTotpCode('')
    await loadFactors()
  }

  async function removeFactor(factorId: string) {
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
      toast.success('Two-factor authentication removed')
      await loadFactors()
    } catch (err) {
      toast.error('Could not remove two-factor', {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">
          Manage your password and two-factor authentication.
        </p>
      </div>

      {/* ── Change password ── */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Change password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                At least 12 characters, with an uppercase letter, a lowercase letter, and a number.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={savingPassword}>
              {savingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Two-factor ── */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {mfaEnabled ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-600" />
            )}
            Two-factor authentication
            {mfaEnabled ? (
              <Badge variant="secondary" className="ml-1">On</Badge>
            ) : (
              <Badge variant="outline" className="ml-1">Off</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Adds a 6-digit code from your phone on top of your password. Strongly recommended
            {isPrivileged ? ' — your account can see and move company money.' : '.'}
          </p>

          {loadingFactors ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking status…
            </div>
          ) : mfaEnabled ? (
            <div className="space-y-3">
              {verifiedFactors.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate text-sm">
                      {f.friendly_name || 'Authenticator app'}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => removeFactor(f.id)}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : enrollQr ? (
            <div className="space-y-4">
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">1. Scan this with your authenticator app</p>
                <div className="inline-block rounded-lg border bg-white p-3">
                  {/* Supabase returns a data: URI SVG/PNG for the QR */}
                  <Image
                    src={enrollQr}
                    alt="Two-factor QR code"
                    width={180}
                    height={180}
                    unoptimized
                  />
                </div>
                {enrollSecret ? (
                  <p className="text-xs text-muted-foreground break-all">
                    Can&apos;t scan? Enter this key manually:{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5">{enrollSecret}</code>
                  </p>
                ) : null}
              </div>
              <form onSubmit={verifyEnroll} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="totpCode">2. Enter the 6-digit code it shows</Label>
                  <Input
                    id="totpCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="max-w-[160px] tracking-widest"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={verifying || totpCode.length !== 6}>
                    {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Turn on two-factor
                  </Button>
                  <Button type="button" variant="ghost" onClick={cancelEnroll}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <Button onClick={startEnroll} disabled={enrolling}>
              {enrolling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Set up two-factor
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
