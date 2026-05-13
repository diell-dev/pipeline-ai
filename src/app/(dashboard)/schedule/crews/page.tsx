'use client'

/**
 * Crews Management Page
 *
 * - Lists crews with their members visible.
 * - Managers can create / edit / delete crews.
 */
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
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
  Trash2,
  Pencil,
  Plus,
} from 'lucide-react'
import type { User } from '@/types/database'

interface CrewWithMembers {
  id: string
  organization_id: string
  name: string
  color: string
  lead_tech_id: string | null
  is_active: boolean
  lead_tech: Pick<User, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
  crew_members: {
    id: string
    user_id: string
    users: Pick<User, 'id' | 'full_name' | 'email' | 'avatar_url' | 'role'> | null
  }[]
}

const COLOR_PALETTE = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
]

export default function CrewsPage() {
  const { user, organization } = useAuthStore()
  const canManage = user?.role ? hasPermission(user.role, 'crews:manage') : false

  const [crews, setCrews] = useState<CrewWithMembers[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<CrewWithMembers | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [form, setForm] = useState({
    name: '',
    color: COLOR_PALETTE[0],
    lead_tech_id: '',
    member_user_ids: [] as string[],
  })

  const loadCrews = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/crews')
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      setCrews(result.crews || [])
    } catch (err) {
      console.error('Failed to load crews:', err)
      toast.error('Failed to load crews')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!organization) return
    loadCrews()

    async function loadUsers() {
      const supabase = createClient()
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('organization_id', organization!.id)
        .eq('is_active', true)
        .neq('role', 'client')
        .order('full_name')
      setUsers(data || [])
    }
    loadUsers()
  }, [organization, loadCrews])

  function openCreate() {
    setEditing(null)
    setForm({
      name: '',
      color: COLOR_PALETTE[0],
      lead_tech_id: '',
      member_user_ids: [],
    })
    setShowDialog(true)
  }

  function openEdit(crew: CrewWithMembers) {
    setEditing(crew)
    setForm({
      name: crew.name,
      color: crew.color,
      lead_tech_id: crew.lead_tech_id || '',
      member_user_ids: crew.crew_members.map((m) => m.user_id),
    })
    setShowDialog(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Crew name is required')
      return
    }

    setSubmitting(true)
    try {
      if (editing) {
        // PATCH crew core fields
        const patchRes = await fetch(`/api/crews/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            color: form.color,
            lead_tech_id: form.lead_tech_id || null,
          }),
        })
        if (!patchRes.ok) {
          const r = await patchRes.json()
          throw new Error(r.error || 'Update failed')
        }

        // Sync members: add/remove diff
        const existingIds = new Set(editing.crew_members.map((m) => m.user_id))
        const newIds = new Set(form.member_user_ids)
        const toAdd = [...newIds].filter((id) => !existingIds.has(id))
        const toRemove = editing.crew_members.filter((m) => !newIds.has(m.user_id))

        for (const user_id of toAdd) {
          await fetch('/api/crew-members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ crew_id: editing.id, user_id }),
          })
        }
        for (const m of toRemove) {
          await fetch(`/api/crew-members/${m.id}`, { method: 'DELETE' })
        }

        toast.success('Crew updated')
      } else {
        const res = await fetch('/api/crews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            color: form.color,
            lead_tech_id: form.lead_tech_id || null,
            member_user_ids: form.member_user_ids,
          }),
        })
        const result = await res.json()
        if (!res.ok) throw new Error(result.error || 'Create failed')
        toast.success('Crew created')
      }

      setShowDialog(false)
      await loadCrews()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(crew: CrewWithMembers) {
    if (!confirm(`Disable crew "${crew.name}"? Members will not be lost.`)) return
    try {
      const res = await fetch(`/api/crews/${crew.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const r = await res.json()
        throw new Error(r.error)
      }
      toast.success('Crew disabled')
      await loadCrews()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error(msg)
    }
  }

  function toggleMember(userId: string) {
    setForm((prev) => ({
      ...prev,
      member_user_ids: prev.member_user_ids.includes(userId)
        ? prev.member_user_ids.filter((id) => id !== userId)
        : [...prev.member_user_ids, userId],
    }))
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Crews</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Group field techs into crews for easier scheduling and dispatch.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Crew
          </Button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && crews.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold mb-1">No crews yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Create a crew to group technicians and assign jobs to them as a unit.
            </p>
            {canManage && (
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Crew
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && crews.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {crews.map((crew) => (
            <Card
              key={crew.id}
              className={crew.is_active ? '' : 'opacity-60'}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-8 w-8 rounded-md shrink-0"
                      style={{ backgroundColor: crew.color }}
                    />
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        {crew.name}
                        {!crew.is_active && (
                          <Badge variant="outline" className="text-[10px]">
                            Disabled
                          </Badge>
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {crew.crew_members.length} member
                        {crew.crew_members.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(crew)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {crew.is_active && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDelete(crew)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {crew.lead_tech && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Lead: <span className="font-medium text-foreground">{crew.lead_tech.full_name}</span>
                  </p>
                )}

                <div className="flex flex-wrap gap-1">
                  {crew.crew_members.map((m) => (
                    <Badge
                      key={m.id}
                      variant="outline"
                      className="text-[10px]"
                    >
                      {m.users?.full_name || 'Unknown'}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Crew' : 'Create Crew'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update crew details and member roster.'
                : 'Group techs into a crew that can be scheduled together.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="crew_name">Crew Name *</Label>
              <Input
                id="crew_name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Crew A"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={`h-8 w-8 rounded-md transition-transform ${
                      form.color === c ? 'ring-2 ring-offset-2 ring-zinc-900 scale-110' : ''
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lead_tech">Lead Tech</Label>
              <select
                id="lead_tech"
                value={form.lead_tech_id}
                onChange={(e) => setForm({ ...form, lead_tech_id: e.target.value })}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">— No lead tech —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Members</Label>
              <div className="border rounded-lg p-2 max-h-48 overflow-y-auto space-y-1">
                {users.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">No users available</p>
                ) : (
                  users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={form.member_user_ids.includes(u.id)}
                        onChange={() => toggleMember(u.id)}
                      />
                      <span className="text-sm">{u.full_name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {u.role}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {editing ? 'Save Changes' : 'Create Crew'}
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
