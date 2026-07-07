'use client'

/** Request more work — creates a service_request the office is notified about. */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/ui/page-header'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'

interface Site { id: string; name: string | null; address: string | null }

export default function PortalRequestPage() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [sites, setSites] = useState<Site[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ site_id: '', summary: '', details: '', urgency: 'normal', preferred_date: '' })

  useEffect(() => {
    if (!user?.client_id) return
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase.from('sites').select('id,name,address').eq('client_id', user.client_id as string)
      setSites((data as Site[]) ?? [])
    })()
  }, [user?.client_id])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.summary.trim()) { toast.error('Please describe what you need'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not submit')
      toast.success('Request sent — we’ll be in touch shortly.')
      router.push('/portal')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.push('/portal/more')} className="-ml-2">
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
      </Button>
      <PageHeader title="Request service" subtitle="Tell us what you need and we’ll follow up." />
      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="space-y-3">
            {sites.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="building">Building</Label>
                <select id="building" value={form.site_id}
                  onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value }))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">Select a building (optional)</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name || s.address}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="summary">What do you need?</Label>
              <Input id="summary" required value={form.summary}
                onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                placeholder="e.g. Clogged drain on the 3rd floor" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="details">Details</Label>
              <Textarea id="details" rows={4} value={form.details}
                onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
                placeholder="Anything that helps us prepare (access, history, urgency)…" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="urgency">Urgency</Label>
                <select id="urgency" value={form.urgency}
                  onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value }))}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pref">Preferred date</Label>
                <Input id="pref" type="date" value={form.preferred_date}
                  onChange={(e) => setForm((f) => ({ ...f, preferred_date: e.target.value }))} />
              </div>
            </div>
            <Button type="submit" disabled={submitting} className="h-11 w-full">
              {submitting ? 'Sending…' : 'Send request'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
