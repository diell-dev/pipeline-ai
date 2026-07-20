'use client'

/**
 * Forced password-change screen (audit S8).
 *
 * Invited users receive a temporary password by email. Middleware redirects
 * them here — and nowhere else — until they choose their own. There is no
 * "skip": the whole point is that an emailed plaintext credential should have
 * a short life.
 *
 * The submit goes to /api/account/change-password, which is the only place
 * able to clear the JWT claim that middleware enforces.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not set your password')

      // Refresh the session so the cleared app_metadata claim reaches the
      // cookie — otherwise middleware would bounce us straight back here.
      const supabase = createClient()
      await supabase.auth.refreshSession()

      toast.success('Password set — welcome aboard')
      router.replace('/')
      router.refresh()
    } catch (err) {
      toast.error('Could not set your password', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary/10">
            <ShieldCheck className="h-5 w-5 text-brand-primary" />
          </div>
          <CardTitle className="text-center text-lg">Choose your password</CardTitle>
          <p className="text-center text-sm text-muted-foreground">
            You signed in with a temporary password we emailed you. Set your own to continue.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                At least 12 characters, with an uppercase letter, a lowercase letter, and a number.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              Set password and continue
            </Button>
            <button
              type="button"
              onClick={signOut}
              className="w-full text-center text-xs text-muted-foreground hover:underline"
            >
              Sign out instead
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
