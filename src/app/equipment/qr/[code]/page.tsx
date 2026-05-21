'use client'

/**
 * Public Tenant Scan Page
 *
 * Lands here when an end-tenant scans a QR sticker. NO AUTH.
 * Shows a minimal "your equipment at [Site], Unit [X]" card and a
 * "Request Service" form that posts to the org's service queue.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Phone,
  Mail,
  Wrench,
} from 'lucide-react'

interface PublicEquipmentResponse {
  siteName: string
  unitNumber: string | null
  categoryName: string | null
  organizationName: string
  organizationPhone?: string | null
  organizationEmail?: string | null
  organizationLogoUrl?: string | null
  makeOrCategory?: string | null
}

type Urgency = 'normal' | 'urgent' | 'emergency'

export default function PublicEquipmentQrPage() {
  const params = useParams()
  const code = useMemo(() => {
    const raw = params.code
    if (Array.isArray(raw)) return raw[0]
    return raw || ''
  }, [params])

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [info, setInfo] = useState<PublicEquipmentResponse | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('normal')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/public/equipment/qr/${encodeURIComponent(String(code))}`, {
          cache: 'no-store',
        })
        if (res.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!res.ok) {
          if (!cancelled) setNotFound(true)
          return
        }
        const data = (await res.json()) as PublicEquipmentResponse
        if (!cancelled) setInfo(data)
      } catch (err) {
        console.error(err)
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [code])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setSubmitError('Please enter your name')
      return
    }
    if (!description.trim()) {
      setSubmitError('Please describe the issue')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/public/equipment/qr/${encodeURIComponent(String(code))}/request-service`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim() || null,
            phone: phone.trim() || null,
            description: description.trim(),
            urgency,
          }),
        }
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Could not submit request')
      }
      setSubmitted(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not submit request'
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // =============== Render ===============

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (notFound || !info) {
    return (
      <div className="max-w-md mx-auto p-6 pt-12">
        <Card>
          <CardContent className="py-12 text-center">
            <Wrench className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <h1 className="text-xl font-semibold mb-2">Equipment not found</h1>
            <p className="text-sm text-muted-foreground">
              This QR code isn&apos;t registered yet — please contact your building manager.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto p-4 sm:p-6 space-y-6">
      {/* Branding header */}
      <header className="text-center pt-4">
        {info.organizationLogoUrl ? (
          <img
            src={info.organizationLogoUrl}
            alt={info.organizationName}
            className="h-10 mx-auto mb-2 object-contain"
          />
        ) : null}
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          {info.organizationName}
        </p>
      </header>

      {/* Equipment summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Equipment at {info.siteName}
            {info.unitNumber ? `, Unit ${info.unitNumber}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {info.categoryName && (
            <p>
              <span className="text-muted-foreground">Type: </span>
              <span className="font-medium">{info.categoryName}</span>
            </p>
          )}
          {info.makeOrCategory && (
            <p>
              <span className="text-muted-foreground">Make/Model: </span>
              <span className="font-medium">{info.makeOrCategory}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Request form or success state */}
      {submitted ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600 mb-3" />
            <h2 className="text-lg font-semibold text-emerald-800 mb-1">
              Request received
            </h2>
            <p className="text-sm text-emerald-700">
              Our team will be in touch shortly.
            </p>
            <div className="mt-4 space-y-1 text-sm">
              {info.organizationPhone && (
                <p className="flex items-center justify-center gap-2 text-emerald-800">
                  <Phone className="h-4 w-4" />
                  <a href={`tel:${info.organizationPhone}`} className="underline">
                    {info.organizationPhone}
                  </a>
                </p>
              )}
              {info.organizationEmail && (
                <p className="flex items-center justify-center gap-2 text-emerald-800">
                  <Mail className="h-4 w-4" />
                  <a href={`mailto:${info.organizationEmail}`} className="underline">
                    {info.organizationEmail}
                  </a>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Service</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label className="text-sm">Your name *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="555-555-5555"
                  />
                </div>
              </div>
              <div>
                <Label className="text-sm">What&apos;s the issue? *</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Briefly describe what's wrong…"
                  className="min-h-[100px]"
                  required
                />
              </div>
              <div>
                <Label className="text-sm">Urgency</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(['normal', 'urgent', 'emergency'] as Urgency[]).map((u) => {
                    const active = urgency === u
                    const tone =
                      u === 'emergency'
                        ? active
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-red-50 text-red-700 border-red-200'
                        : u === 'urgent'
                        ? active
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                        : active
                        ? 'bg-zinc-900 text-white border-zinc-900'
                        : 'bg-white text-zinc-700 border-zinc-200'
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setUrgency(u)}
                        className={`rounded-md px-3 py-2 text-sm font-medium border transition-colors ${tone}`}
                      >
                        {u[0].toUpperCase() + u.slice(1)}
                      </button>
                    )
                  })}
                </div>
              </div>
              {submitError && <p className="text-sm text-red-600">{submitError}</p>}
              <Button type="submit" className="w-full h-12" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Send Request
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <footer className="text-center text-xs text-muted-foreground pt-2 pb-6">
        {info.organizationPhone && (
          <p>
            Questions? Call{' '}
            <a href={`tel:${info.organizationPhone}`} className="underline">
              {info.organizationPhone}
            </a>
          </p>
        )}
      </footer>
    </div>
  )
}
