'use client'

/**
 * Team Management Page
 *
 * Shows all team members in the organization.
 * Owner/Super Admin can:
 *   - See all members with roles
 *   - Invite new members (creates auth user + users row)
 *   - Remove members (deactivates them)
 * Other roles see the team list but cannot manage.
 */
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, getRoleLabel, canManageRole } from '@/lib/permissions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Users,
  UserPlus,
  Loader2,
  Mail,
  Phone,
  Trash2,
} from 'lucide-react'
import type { User, UserRole } from '@/types/database'

const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-red-100 text-red-700',
  owner: 'bg-blue-100 text-blue-700',
  office_manager: 'bg-purple-100 text-purple-700',
  field_tech: 'bg-green-100 text-green-700',
  client: 'bg-zinc-100 text-zinc-700',
}

export default function TeamPage() {
  const { user, organization } = useAuthStore()
  const canInvite = user?.role ? hasPermission(user.role, 'users:invite') : false
  const canManage = user?.role ? hasPermission(user.role, 'users:manage') : false

  const [members, setMembers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // Invite form
  const [inviteForm, setInviteForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    role: 'field_tech' as UserRole,
  })

  // Load team members
  useEffect(() => {
    if (!organization) return

    async function loadMembers() {
      setLoading(true)
      const supabase = createClient()

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('organization_id', organization!.id)
        .eq('is_active', true)
        .order('role')
        .order('full_name')

      if (error) {
        console.error('Failed to load team:', error.message)
        toast.error('Failed to load team members')
      } else {
        setMembers((data || []).filter((m: any) => m.role !== 'super_admin'))
      }
      setLoading(false)
    }

    loadMembers()
  }, [organization])

  // Invite member via API
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()

    if (!inviteForm.full_name.trim() || !inviteForm.email.trim()) {
      toast.error('Name and email are required')
      return
    }

    setInviting(true)
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: inviteForm.full_name.trim(),
          email: inviteForm.email.trim().toLowerCase(),
          phone: inviteForm.phone.trim() || null,
          role: inviteForm.role,
          organization_id: organization!.id,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        throw new Error(result.error || 'Invitation failed')
      }

      // Add new member to list
      if (result.user) {
        setMembers((prev) =>
          [...prev, result.user].sort((a, b) => a.full_name.localeCompare(b.full_name))
        )
      }

      toast.success(`${inviteForm.full_name} has been added to the team`)
      setShowInvite(false)
      setInviteForm({ full_name: '', email: '', phone: '', role: 'field_tech' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Invite failed:', msg)
      toast.error(msg)
    } finally {
      setInviting(false)
    }
  }

  // Remove member (deactivate)
  async function handleRemove(member: User) {
    if (!confirm(`Are you sure you want to remove ${member.full_name} from the team?`)) return

    setRemovingId(member.id)
    try {
      const supabase = createClient()

      const { error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', member.id)

      if (error) throw error

      setMembers((prev) => prev.filter((m) => m.id !== member.id))
      toast.success(`${member.full_name} has been removed from the team`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Remove failed:', msg)
      toast.error('Failed to remove team member')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground">
            {members.length} team member{members.length !== 1 ? 's' : ''} in your organization.
          </p>
        </div>
        {canInvite && (
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Member
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No team members</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Invite field technicians, office managers, and other team members to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const isCurrentUser = member.id === user?.id
            const canRemoveThis =
              canManage &&
              !isCurrentUser &&
              user?.role !== undefined &&
              canManageRole(user!.role, member.role)

            return (
              <Card key={member.id}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-zinc-200 flex items-center justify-center text-sm font-semibold text-zinc-600 shrink-0">
                        {member.full_name?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">
                            {member.full_name}
                          </span>
                          {isCurrentUser && (
                            <Badge variant="outline" className="text-[10px]">You</Badge>
                          )}
                          <Badge className={`text-[10px] border-0 ${ROLE_COLORS[member.role]}`}>
                            {getRoleLabel(member.role)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {member.email}
                          </span>
                          {member.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {member.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {canRemoveThis && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleRemove(member)}
                        disabled={removingId === member.id}
                      >
                        {removingId === member.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Add a new member to your organization. They&apos;ll receive login credentials at the email address you provide.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite_name">Full Name *</Label>
              <Input
                id="invite_name"
                value={inviteForm.full_name}
                onChange={(e) => setInviteForm({ ...inviteForm, full_name: e.target.value })}
                placeholder="John Smith"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite_email">Email *</Label>
              <Input
                id="invite_email"
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                placeholder="john@example.com"
                required
              />
              <p className="text-xs text-muted-foreground">
                This email cannot be changed by the team member later.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite_phone">Phone</Label>
              <Input
                id="invite_phone"
                type="tel"
                value={inviteForm.phone}
                onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite_role">Role *</Label>
              <select
                id="invite_role"
                value={inviteForm.role}
                onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as UserRole })}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="field_tech">Field Technician</option>
                <option value="office_manager">Office Manager</option>
              </select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Inviting...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
