'use client'

/**
 * Profile Page — Editable
 *
 * Users can update their full name and phone number.
 * Email is always read-only (set by owner at invite time).
 * Role is read-only for all users.
 * Owner can also edit their own email.
 */
import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { getRoleLabel } from '@/lib/permissions'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export default function ProfilePage() {
  const { user, setSession, organization } = useAuthStore()

  const [fullName, setFullName] = useState(user?.full_name || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [saving, setSaving] = useState(false)

  const isOwner = user?.role === 'owner' || user?.role === 'super_admin'

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    if (!fullName.trim()) {
      toast.error('Full name is required')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()

      const { data, error } = await supabase
        .from('users')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        })
        .eq('id', user!.id)
        .select()
        .single()

      if (error) throw error

      // Update the auth store with the new user data
      if (organization) {
        setSession(data as typeof user & Record<string, unknown>, organization)
      }

      toast.success('Profile updated successfully')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Failed to update profile:', msg)
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Your personal account information.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Personal Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex items-center gap-4 mb-6">
              <div className="h-16 w-16 rounded-full bg-zinc-200 flex items-center justify-center text-2xl font-semibold text-zinc-600">
                {fullName?.charAt(0) || '?'}
              </div>
              <div>
                <p className="font-medium text-lg">{fullName || user?.full_name}</p>
                <p className="text-sm text-muted-foreground">
                  {user?.role ? getRoleLabel(user.role) : ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email
                  <span className="text-xs text-muted-foreground ml-1">(read-only)</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  defaultValue={user?.email || ''}
                  disabled
                  className="bg-zinc-50"
                />
                {!isOwner && (
                  <p className="text-xs text-muted-foreground">
                    Email is set by your organization owner and cannot be changed.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">
                  Role
                  <span className="text-xs text-muted-foreground ml-1">(read-only)</span>
                </Label>
                <Input
                  id="role"
                  defaultValue={user?.role ? getRoleLabel(user.role) : ''}
                  disabled
                  className="bg-zinc-50"
                />
              </div>
            </div>

            <div className="pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
