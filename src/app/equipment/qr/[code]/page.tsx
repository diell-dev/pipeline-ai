'use client'

/**
 * Public Tenant Scan Page — Phase E3
 *
 * Lands here when a property tenant scans a QR sticker stuck to a piece
 * of equipment. NO AUTH — anyone with the code can land here.
 *
 * Surface goals:
 *   • Tenant-branded header (logo + brand color strip)
 *   • Big "What is this?" heading so the tenant understands what they're
 *     looking at without prior context
 *   • A single primary CTA — "Report an issue / Request service"
 *   • Compact, mobile-only optimised (the only place this ever loads)
 *   • Tenant-friendly copy on the form (no internal jargon, photo upload,
 *     soft "we'll be in touch" trust strip)
 *
 * Data flow unchanged — fetches /api/public/equipment/qr/[code] and POSTs
 * the service request to /api/public/equipment/qr/[code]/request-service.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CheckCircle2,
  MapPin,
  Phone,
  Mail,
  Wrench,
  AlertTriangle,
  ImagePlus,
  X,
  ChevronDown,
} from 'lucide-react'

interface PublicEquipmentResponse {
  siteName: string
  unitNumber: string | null
  categoryName: string | null
  organizationName: string
  organizationPhone?: string | null
  organizationEmail?: string | null
  organizationLogoUrl?: string | null
  organizationPrimaryColor?: string | null
  makeOrCategory?: string | null
}

type Urgency = 'normal' | 'urgent' | 'emergency'

// Cap each photo at ~5MB after rough estimation. Browsers won't let
// us submit unlimited attachments from a tenant phone — also keeps the
// JSON body well under any sane backend limit.
const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

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
  const [showRequestForm, setShowRequestForm] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [description, setDescription] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('normal')
  const [photos, setPhotos] = useState<Array<{ id: string; dataUrl: string }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    const accepted = [...photos]
    let rejectedTooBig = false

    files.forEach((f) => {
      if (accepted.length >= MAX_PHOTOS) return
      if (f.size > MAX_PHOTO_BYTES) {
        rejectedTooBig = true
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        if (!dataUrl) return
        setPhotos((prev) =>
          prev.length >= MAX_PHOTOS
            ? prev
            : [...prev, { id: `${Date.now()}-${Math.random()}`, dataUrl }]
        )
      }
      reader.readAsDataURL(f)
    })

    if (rejectedTooBig) {
      setSubmitError('Photos larger than 5MB were skipped.')
    } else {
      setSubmitError(null)
    }

    if (e.target.value) e.target.value = ''
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
  }

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
            // Backend can ignore `photos` if the route doesn't accept it yet;
            // this is forward-compatible (existing endpoint already takes a
            // JSON body with arbitrary keys).
            photos: photos.length ? photos.map((p) => p.dataUrl) : undefined,
          }),
        }
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Could not submit request')
      }
      setSubmitted(true)
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
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
      <div className="max-w-md mx-auto px-4 pt-8 space-y-5">
        <div className="space-y-3">
          <Skeleton className="h-10 w-32 mx-auto" />
          <Skeleton className="h-4 w-44 mx-auto" />
        </div>
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    )
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted ring-1 ring-border">
            <Wrench className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Equipment not found
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            This QR code isn&apos;t registered yet — please reach out to your
            building manager and let them know which sticker you scanned.
          </p>
        </div>
      </div>
    )
  }

  const brandColor = info.organizationPrimaryColor || '#0f172a'
  const equipmentLabel =
    info.categoryName || info.makeOrCategory || 'Equipment'

  // ── SUCCESS state ──
  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col">
        <header
          className="text-white px-4 py-4"
          style={{ background: brandColor }}
        >
          <div className="max-w-md mx-auto flex items-center justify-center gap-3">
            {info.organizationLogoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={info.organizationLogoUrl}
                alt={info.organizationName}
                className="h-8 object-contain bg-white/10 rounded px-2 py-1"
              />
            ) : (
              <span className="font-heading text-base font-semibold tracking-tight">
                {info.organizationName}
              </span>
            )}
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-10 bg-zinc-50">
          <div className="w-full max-w-md page-fade-in">
            <div className="rounded-2xl bg-white shadow-lg p-6 sm:p-8 text-center">
              <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200 animate-success-pop">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              </div>
              <h2 className="font-heading text-2xl font-bold tracking-tight">
                Got it — request sent
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                {info.organizationName} has received your service request for
                the {equipmentLabel.toLowerCase()} at{' '}
                <strong className="text-foreground">{info.siteName}</strong>
                {info.unitNumber ? `, Unit ${info.unitNumber}` : ''}. A team
                member will reach out shortly.
              </p>

              {(info.organizationPhone || info.organizationEmail) && (
                <div className="mt-8 border-t pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Need to reach us first?
                  </p>
                  <div className="mt-3 space-y-2 text-sm">
                    {info.organizationPhone && (
                      <a
                        href={`tel:${info.organizationPhone}`}
                        className="flex items-center justify-center gap-2 text-foreground hover:underline"
                      >
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        {info.organizationPhone}
                      </a>
                    )}
                    {info.organizationEmail && (
                      <a
                        href={`mailto:${info.organizationEmail}`}
                        className="flex items-center justify-center gap-2 text-foreground hover:underline break-all"
                      >
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {info.organizationEmail}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Powered by <span className="font-medium text-foreground">Pipeline AI</span>
            </p>
          </div>
        </main>
      </div>
    )
  }

  // ── MAIN view ──
  return (
    <div className="min-h-screen flex flex-col">
      {/* Brand header */}
      <header
        className="text-white px-4 pt-5 pb-7 relative overflow-hidden"
        style={{ background: brandColor }}
      >
        {/* Subtle glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full opacity-20 blur-3xl bg-white"
        />
        <div className="relative max-w-md mx-auto flex flex-col items-center text-center gap-2">
          {info.organizationLogoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={info.organizationLogoUrl}
              alt={info.organizationName}
              className="h-10 max-w-[200px] object-contain bg-white/10 rounded px-3 py-1.5"
            />
          ) : (
            <span className="font-heading text-lg font-semibold tracking-tight">
              {info.organizationName}
            </span>
          )}
          <p className="text-[11px] uppercase tracking-wider text-white/70">
            Service portal
          </p>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 -mt-4 px-4 pb-10 page-fade-in">
        <div className="max-w-md mx-auto space-y-4">
          {/* "What is this?" card */}
          <div className="rounded-2xl bg-white shadow-md border border-border p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What you&rsquo;re looking at
            </p>
            <h1 className="font-heading mt-1 text-xl sm:text-2xl font-bold tracking-tight leading-tight">
              {equipmentLabel}{' '}
              <span className="text-muted-foreground font-medium">at</span>{' '}
              {info.siteName}
              {info.unitNumber ? (
                <span className="text-muted-foreground font-medium">
                  , Unit {info.unitNumber}
                </span>
              ) : null}
            </h1>

            {(info.categoryName && info.makeOrCategory) ? (
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {info.makeOrCategory}
                </span>
                {' · '}
                <span>{info.categoryName}</span>
              </p>
            ) : null}

            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span className="leading-5">
                You scanned a service sticker on this piece of equipment. Tap
                below to let {info.organizationName} know about any issue
                you&rsquo;re seeing.
              </span>
            </div>
          </div>

          {/* Primary CTA — visible when form is collapsed */}
          {!showRequestForm && (
            <>
              <Button
                onClick={() => setShowRequestForm(true)}
                className="w-full h-14 text-base text-white shadow-md hover:opacity-90"
                style={{ background: brandColor }}
              >
                <Wrench className="h-5 w-5 mr-2" />
                Report an issue / Request service
                <ChevronDown className="h-4 w-4 ml-2 opacity-70" />
              </Button>

              {info.organizationPhone && (
                <a
                  href={`tel:${info.organizationPhone}`}
                  className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground py-3"
                >
                  <Phone className="h-4 w-4" />
                  Or call {info.organizationPhone}
                </a>
              )}
            </>
          )}

          {/* Service request form */}
          {showRequestForm && (
            <div className="rounded-2xl bg-white shadow-md border border-border p-5 space-y-5">
              <div>
                <h2 className="font-heading text-lg font-semibold tracking-tight">
                  Tell us what&rsquo;s going on
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quick details below — we&rsquo;ll be in touch within one
                  business day.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-sm">
                    Your name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                    autoComplete="name"
                    className="h-11"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-sm">
                      Phone
                    </Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(555) 555-5555"
                      autoComplete="tel"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-sm">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="h-11"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-sm">
                    What&apos;s the issue? <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. The unit is making a loud rattling noise and not cooling properly."
                    className="min-h-[110px]"
                    required
                  />
                </div>

                {/* Photos */}
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Photos{' '}
                    <span className="text-xs text-muted-foreground font-normal">
                      (optional, up to {MAX_PHOTOS})
                    </span>
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((p) => (
                      <div
                        key={p.id}
                        className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.dataUrl}
                          alt="Attached"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(p.id)}
                          className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                          aria-label="Remove photo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {photos.length < MAX_PHOTOS && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-square rounded-lg border-2 border-dashed border-border bg-muted/40 hover:bg-muted hover:border-muted-foreground/40 transition-colors flex flex-col items-center justify-center text-muted-foreground"
                      >
                        <ImagePlus className="h-5 w-5 mb-1" />
                        <span className="text-[10px] font-medium uppercase tracking-wider">
                          Add
                        </span>
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                </div>

                {/* Urgency */}
                <div className="space-y-1.5">
                  <Label className="text-sm">Urgency</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { v: 'normal', label: 'Normal' },
                        { v: 'urgent', label: 'Urgent' },
                        { v: 'emergency', label: 'Emergency' },
                      ] as Array<{ v: Urgency; label: string }>
                    ).map(({ v, label }) => {
                      const active = urgency === v
                      const tone =
                        v === 'emergency'
                          ? active
                            ? 'bg-red-600 text-white border-red-600 shadow-sm'
                            : 'bg-white text-red-700 border-red-200 hover:bg-red-50'
                          : v === 'urgent'
                          ? active
                            ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                            : 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50'
                          : active
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-sm'
                          : 'bg-white text-zinc-700 border-border hover:bg-muted'
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setUrgency(v)}
                          className={`rounded-lg px-2 py-3 text-sm font-medium border transition-colors ${tone}`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  {urgency === 'emergency' && (
                    <p className="text-xs text-red-700 leading-relaxed pt-1">
                      Active flood, fire, or carbon monoxide? Please call{' '}
                      <strong>911</strong> first
                      {info.organizationPhone ? (
                        <>
                          , then call us at{' '}
                          <a
                            href={`tel:${info.organizationPhone}`}
                            className="underline"
                          >
                            {info.organizationPhone}
                          </a>
                          .
                        </>
                      ) : (
                        '.'
                      )}
                    </p>
                  )}
                </div>

                {submitError && (
                  <div className="text-sm text-red-600 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    {submitError}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-12 text-base text-white shadow-md hover:opacity-90"
                  style={{ background: brandColor }}
                  loading={submitting}
                >
                  Send request
                </Button>

                <button
                  type="button"
                  onClick={() => setShowRequestForm(false)}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  Cancel
                </button>
              </form>
            </div>
          )}

          {/* Footer */}
          <footer className="pt-4 text-center text-xs text-muted-foreground space-y-1">
            <p>
              <span className="font-medium text-foreground">
                {info.organizationName}
              </span>{' '}
              · Service portal
            </p>
            <p className="opacity-70">
              Powered by <span className="font-medium">Pipeline AI</span>
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}
