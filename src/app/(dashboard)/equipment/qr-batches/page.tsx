'use client'

/**
 * QR Sticker Batches
 *
 * Owners/managers generate batches of QR codes here. Each batch is a PDF
 * of stickers that techs apply to equipment in the field; on scan, the
 * sticker is "claimed" by being linked to a piece of equipment.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, type Permission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  Loader2,
  Plus,
  QrCode,
  Download,
  ArrowLeft,
} from 'lucide-react'

interface QrBatch {
  id: string
  batch_number: string | number
  prefix: string | null
  total_codes: number
  claimed_count: number
  created_at: string
  notes?: string | null
}

export default function QrBatchesPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const canManage = user?.role
    ? hasPermission(user.role, 'equipment:manage_qr_batches' as Permission)
    : false

  const [batches, setBatches] = useState<QrBatch[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [count, setCount] = useState<number>(50)
  const [prefix, setPrefix] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    // Auto-fill prefix from org name if available
    if (organization?.name && !prefix) {
      setPrefix(organization.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.name])

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/equipment/qr-batches', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setBatches(Array.isArray(data) ? data : data?.batches || [])
      } else {
        setBatches([])
      }
    } catch (err) {
      console.error('Failed to load batches', err)
      setBatches([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate() {
    if (count < 1 || count > 500) {
      toast.error('Count must be 1 – 500')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/equipment/qr-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, prefix: prefix.trim() || null, notes: notes.trim() || null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Failed to create batch')
      }
      const json = await res.json()
      toast.success(`Generated ${count} codes`)
      setDialogOpen(false)
      setCount(50)
      setNotes('')
      await load()
      // Auto-download the PDF if we got an id back
      if (json.batch_id) {
        window.open(`/api/equipment/qr-batches/${json.batch_id}/pdf`, '_blank')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create batch'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">
              You don&apos;t have permission to manage QR batches.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.push('/equipment')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">QR Sticker Batches</h1>
          <p className="text-sm text-muted-foreground">
            Generate sheets of QR codes to apply to equipment in the field.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Batch
        </Button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && batches.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <QrCode className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No batches yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Create your first batch of stickers — print, slap, scan.
            </p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create First Batch
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && batches.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Batch #</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Prefix</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Codes</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Claimed</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Generated</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">PDF</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono">{b.batch_number}</td>
                    <td className="px-4 py-3 font-mono">{b.prefix || '—'}</td>
                    <td className="px-4 py-3">{b.total_codes}</td>
                    <td className="px-4 py-3">
                      {b.claimed_count}/{b.total_codes}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(b.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/api/equipment/qr-batches/${b.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate QR Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm">How many codes? (1–500)</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label className="text-sm">Prefix (4 chars max)</Label>
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="e.g. NYSD"
              />
            </div>
            <div>
              <Label className="text-sm">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Roll #4, printed for the Hempstead route"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
