'use client'

/**
 * Public Proposal Sign Page — Phase E2
 *
 * Customer-facing estimate sign experience. Uses the tenant's brand
 * colors + logo to feel like the contractor's product (not Pipeline's),
 * lifts line items into a clean tabular/card layout, sharpens the totals
 * hierarchy, and replaces the inline "done" notice with a full success
 * screen that includes a Phase F check-mark pop, "What's next" copy, and
 * tenant contact info.
 *
 * Data flow is untouched — we still hit /api/proposals/public/[token]
 * and POST signatures to the same endpoints.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PenTool,
  Type,
  Eraser,
  Calendar,
  MapPin,
  Phone,
  Mail,
  Globe,
  FileText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

interface PublicProposal {
  proposal_number: string
  status: string
  issue_description: string
  proposed_solution: string
  subtotal: number
  discount_enabled: boolean
  discount_amount: number
  discount_reason: string | null
  tax_rate: number
  tax_amount: number
  total_amount: number
  valid_until: string | null
  client?: { company_name: string; primary_contact_name: string } | null
  site?: { name: string; address: string; borough: string | null } | null
}

interface PublicLineItem {
  id: string
  service_name: string
  description: string | null
  quantity: number
  unit: string
  unit_price: number
  total: number
  sort_order: number
}

interface PublicOrg {
  name: string
  logo_url: string | null
  primary_color: string
  accent_color: string | null
  company_phone: string | null
  company_email: string | null
  company_website: string | null
  company_address: string | null
}

interface PublicResponse {
  proposal: PublicProposal
  line_items: PublicLineItem[]
  organization: PublicOrg | null
  expired: boolean
  already_signed: boolean
  already_rejected: boolean
}

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function PublicProposalSignPage() {
  const params = useParams()
  const token = params.token as string

  const [data, setData] = useState<PublicResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Sign form
  const [tab, setTab] = useState<'typed' | 'drawn'>('typed')
  const [signedName, setSignedName] = useState('')
  const [signedEmail, setSignedEmail] = useState('')
  const [signedTitle, setSignedTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectSubmitting, setRejectSubmitting] = useState(false)
  const [rejected, setRejected] = useState(false)

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)

  // Load proposal
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/proposals/public/${token}`, { cache: 'no-store' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setErrorMsg(j.error || 'Proposal not found')
          setLoading(false)
          return
        }
        const json = (await res.json()) as PublicResponse
        setData(json)
      } catch {
        setErrorMsg('Failed to load proposal')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  // Canvas drawing setup
  useEffect(() => {
    if (tab !== 'drawn') return
    const canvas = canvasRef.current
    if (!canvas) return

    function resize() {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(dpr, dpr)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 2
        ctx.strokeStyle = '#111'
      }
    }

    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const rafId = window.requestAnimationFrame(() => {
      resize()
      if (canvas.clientWidth === 0) {
        retryTimer = setTimeout(resize, 50)
      }
    })

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => resize())
        : null
    ro?.observe(canvas)

    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(rafId)
      if (retryTimer) clearTimeout(retryTimer)
      ro?.disconnect()
    }
  }, [tab])

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true
    lastPointRef.current = getCanvasPoint(e)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pt = getCanvasPoint(e)
    const last = lastPointRef.current
    if (last) {
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
    }
    lastPointRef.current = pt
    if (!hasDrawn) setHasDrawn(true)
  }
  function handlePointerUp() {
    drawingRef.current = false
    lastPointRef.current = null
  }
  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    setHasDrawn(false)
  }

  const submitSignature = useCallback(async () => {
    if (!signedName.trim()) {
      setErrorMsg('Please enter your full name')
      return
    }
    if (!signedEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signedEmail)) {
      setErrorMsg('Please enter a valid email')
      return
    }

    let signatureData = ''
    if (tab === 'typed') {
      signatureData = signedName.trim()
    } else {
      const canvas = canvasRef.current
      if (!canvas || !hasDrawn) {
        setErrorMsg('Please draw your signature')
        return
      }
      signatureData = canvas.toDataURL('image/png')
    }

    setErrorMsg(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/proposals/public/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signed_by_name: signedName.trim(),
          signed_by_email: signedEmail.trim(),
          signed_by_title: signedTitle.trim() || null,
          signature_data: signatureData,
          signature_type: tab,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to sign')
      }
      setSuccess(true)
      // Scroll back to the top so the success screen takes the viewport.
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit signature')
    } finally {
      setSubmitting(false)
    }
  }, [signedName, signedEmail, signedTitle, tab, hasDrawn, token])

  async function submitReject() {
    if (!rejectReason.trim()) {
      setErrorMsg('Please tell us why')
      return
    }
    setErrorMsg(null)
    setRejectSubmitting(true)
    try {
      const res = await fetch(`/api/proposals/public/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to reject')
      }
      setRejected(true)
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setRejectSubmitting(false)
    }
  }

  // ── Render states ──
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-6 sm:py-10 px-3 sm:px-4">
        <Skeleton className="h-24 rounded-t-2xl rounded-b-none" />
        <div className="rounded-b-2xl bg-white shadow-md p-4 sm:p-8 space-y-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="space-y-3 pt-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!data || (errorMsg && !data)) {
    return (
      <div className="max-w-xl mx-auto py-24 px-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-200">
              <AlertTriangle className="h-7 w-7 text-amber-600" />
            </div>
            <h1 className="font-heading text-xl font-bold mb-2">Estimate not available</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              {errorMsg ||
                'This estimate may have expired or the link is no longer valid. Please contact us if you believe this is a mistake.'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const proposal = data.proposal
  const org = data.organization
  const primaryColor = org?.primary_color || '#0f172a'
  const accentColor = org?.accent_color || primaryColor
  const totallyDone =
    success ||
    rejected ||
    data.already_signed ||
    data.already_rejected ||
    proposal.status === 'converted_to_job'

  const wasRejected = rejected || data.already_rejected
  const wasSigned = success || data.already_signed

  // ──────────────────────────────────────────────────────────────────────
  // SUCCESS / DONE SCREENS — full-page polished confirmation
  // ──────────────────────────────────────────────────────────────────────
  if (totallyDone) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Branded header bar */}
        <header
          className="text-white px-4 sm:px-6 py-4 shadow-md"
          style={{ background: primaryColor }}
        >
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {org?.logo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={org.logo_url}
                  alt={org.name}
                  referrerPolicy="no-referrer"
                  className="max-h-9 sm:max-h-10 max-w-[140px] sm:max-w-[180px] object-contain bg-white/10 rounded p-1"
                />
              ) : (
                <h1 className="font-heading text-base sm:text-lg font-semibold truncate">
                  {org?.name || 'Service Estimate'}
                </h1>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[10px] uppercase tracking-wider opacity-75">Estimate</p>
              <p className="text-xs sm:text-sm font-mono">{proposal.proposal_number}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-10 sm:py-14 bg-zinc-50">
          <div className="w-full max-w-xl page-fade-in">
            {wasRejected && !wasSigned ? (
              <Card className="overflow-hidden">
                <CardContent className="px-6 py-10 sm:py-14 text-center">
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-200 animate-success-pop">
                    <XCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
                    Estimate declined
                  </h2>
                  <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                    Thanks for taking the time to review. We&rsquo;ve let{' '}
                    {org?.name || 'the team'} know — reach out anytime if
                    anything changes.
                  </p>

                  {(org?.company_phone || org?.company_email) && (
                    <div className="mt-8 space-y-2 text-sm">
                      {org?.company_phone && (
                        <a
                          href={`tel:${org.company_phone}`}
                          className="inline-flex items-center justify-center gap-2 text-foreground hover:underline"
                        >
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          {org.company_phone}
                        </a>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <CardContent className="px-6 py-10 sm:py-14">
                  <div className="text-center">
                    {/* Animated check */}
                    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200 animate-success-pop">
                      <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                    </div>
                    <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
                      {wasSigned ? 'Estimate signed!' : 'This estimate is complete'}
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                      {wasSigned
                        ? `Thank you. We've received your approval for ${proposal.proposal_number} — totalling ${fmtUSD(Number(proposal.total_amount))}.`
                        : 'No further action is needed on your part.'}
                    </p>
                  </div>

                  {wasSigned && (
                    <div className="mt-8 border-t pt-6">
                      <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        What happens next
                      </h3>
                      <ol className="mt-4 space-y-4">
                        {[
                          {
                            n: 1,
                            title: "We'll reach out to schedule",
                            body:
                              "Our team will contact you within one business day to confirm a service date.",
                          },
                          {
                            n: 2,
                            title: 'A crew is dispatched',
                            body:
                              "You'll get an arrival window and the technician's name before they arrive on-site.",
                          },
                          {
                            n: 3,
                            title: "Job complete, invoice follows",
                            body:
                              'Once the work is done you receive a final invoice with payment options.',
                          },
                        ].map((step) => (
                          <li key={step.n} className="flex gap-3">
                            <span
                              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                              style={{ background: accentColor }}
                            >
                              {step.n}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {step.title}
                              </p>
                              <p className="mt-0.5 text-sm text-muted-foreground leading-relaxed">
                                {step.body}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Contact strip */}
                  {(org?.company_phone || org?.company_email || org?.company_website) && (
                    <div className="mt-8 border-t pt-6">
                      <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Questions? Reach {org?.name || 'us'}
                      </h3>
                      <div className="mt-4 grid gap-2 text-sm">
                        {org?.company_phone && (
                          <a
                            href={`tel:${org.company_phone}`}
                            className="flex items-center gap-3 text-foreground hover:underline"
                          >
                            <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>{org.company_phone}</span>
                          </a>
                        )}
                        {org?.company_email && (
                          <a
                            href={`mailto:${org.company_email}`}
                            className="flex items-center gap-3 text-foreground hover:underline break-all"
                          >
                            <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>{org.company_email}</span>
                          </a>
                        )}
                        {org?.company_website && (
                          <a
                            href={
                              org.company_website.startsWith('http')
                                ? org.company_website
                                : `https://${org.company_website}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 text-foreground hover:underline break-all"
                          >
                            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>{org.company_website}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Powered-by footer (small, unobtrusive) */}
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Powered by <span className="font-medium text-foreground">Pipeline AI</span>
            </p>
          </div>
        </main>
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────────────────
  // MAIN VIEW — review + sign
  // ──────────────────────────────────────────────────────────────────────
  const itemCount = data.line_items?.length ?? 0

  return (
    <div className="max-w-3xl mx-auto py-4 sm:py-8 px-3 sm:px-4 page-fade-in">
      {/* ── Branded hero header ── */}
      <div
        className="rounded-t-2xl text-white p-5 sm:p-8 shadow-md relative overflow-hidden"
        style={{ background: primaryColor }}
      >
        {/* Soft decorative glow in the corner — uses accent color */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full opacity-20 blur-3xl"
          style={{ background: accentColor }}
        />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {org?.logo_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={org.logo_url}
                alt={org.name}
                referrerPolicy="no-referrer"
                className="max-h-10 sm:max-h-12 max-w-[140px] sm:max-w-[180px] object-contain bg-white/10 rounded p-1"
              />
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                  <FileText className="h-5 w-5" />
                </div>
                <h1 className="font-heading text-lg sm:text-xl font-semibold tracking-tight truncate">
                  {org?.name || 'Service Estimate'}
                </h1>
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] uppercase tracking-wider opacity-75">Estimate</p>
            <p className="text-xs sm:text-sm font-mono">{proposal.proposal_number}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-b-2xl shadow-md p-4 sm:p-8 space-y-7">
        {/* Greeting */}
        <section>
          <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
            Estimate for{' '}
            <span style={{ color: primaryColor }}>
              {proposal.client?.company_name || 'Your Property'}
            </span>
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            {proposal.site?.address && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {proposal.site.address}
              </span>
            )}
            {proposal.valid_until && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Valid through{' '}
                {new Date(proposal.valid_until).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            )}
          </div>
        </section>

        {/* Issue */}
        <section>
          <h3
            className="font-heading text-xs uppercase tracking-wider font-semibold mb-2"
            style={{ color: accentColor }}
          >
            The issue
          </h3>
          <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">
            {proposal.issue_description}
          </p>
        </section>

        {/* Proposed Solution */}
        <section>
          <h3
            className="font-heading text-xs uppercase tracking-wider font-semibold mb-2"
            style={{ color: accentColor }}
          >
            Proposed solution
          </h3>
          <p className="text-sm leading-6 whitespace-pre-wrap text-foreground">
            {proposal.proposed_solution}
          </p>
        </section>

        {/* Line items */}
        {itemCount > 0 && (
          <section>
            <h3
              className="font-heading text-xs uppercase tracking-wider font-semibold mb-3"
              style={{ color: accentColor }}
            >
              Services included
              <span className="ml-2 text-muted-foreground/70 font-normal normal-case tracking-normal">
                ({itemCount} item{itemCount === 1 ? '' : 's'})
              </span>
            </h3>

            {/* Desktop: table */}
            <div className="hidden sm:block rounded-xl border border-border overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/40">
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-4 py-2.5 font-semibold">Item</th>
                    <th className="text-center px-4 py-2.5 font-semibold w-20">Qty</th>
                    <th className="text-right px-4 py-2.5 font-semibold w-28">Price</th>
                    <th className="text-right px-4 py-2.5 font-semibold w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.line_items.map((li, idx) => (
                    <tr
                      key={li.id}
                      className={`border-t border-border/60 row-stagger-up ${
                        idx % 2 === 1 ? 'bg-muted/20' : ''
                      }`}
                      style={{ '--row-index': idx } as React.CSSProperties}
                    >
                      <td className="px-4 py-3 align-top">
                        <p className="font-medium text-foreground">{li.service_name}</p>
                        {li.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 leading-5">
                            {li.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground tabular-nums align-top">
                        {li.quantity}
                        {li.unit ? (
                          <span className="text-xs ml-0.5 opacity-70">{li.unit}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums align-top">
                        {fmtUSD(Number(li.unit_price))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums align-top">
                        {fmtUSD(Number(li.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: card list */}
            <div className="sm:hidden space-y-2.5">
              {data.line_items.map((li, idx) => (
                <div
                  key={li.id}
                  className="rounded-xl border border-border bg-white p-3.5 text-sm row-stagger-up"
                  style={{ '--row-index': idx } as React.CSSProperties}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-foreground min-w-0">
                      {li.service_name}
                    </p>
                    <p className="font-semibold tabular-nums flex-shrink-0">
                      {fmtUSD(Number(li.total))}
                    </p>
                  </div>
                  {li.description && (
                    <p className="text-xs text-muted-foreground mt-1 leading-5">
                      {li.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2 tabular-nums">
                    {li.quantity}
                    {li.unit ? ` ${li.unit}` : ''} ×{' '}
                    {fmtUSD(Number(li.unit_price))}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Totals — strong hierarchy */}
        <section className="rounded-xl bg-muted/40 border border-border p-4 sm:p-5">
          <dl className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium tabular-nums">
                {fmtUSD(Number(proposal.subtotal))}
              </dd>
            </div>
            {proposal.discount_enabled && Number(proposal.discount_amount) > 0 && (
              <div className="flex items-center justify-between text-sm">
                <dt className="text-muted-foreground">
                  Discount
                  {proposal.discount_reason ? ` (${proposal.discount_reason})` : ''}
                </dt>
                <dd className="font-medium tabular-nums text-red-600">
                  −{fmtUSD(Number(proposal.discount_amount))}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <dt className="text-muted-foreground">
                Tax ({proposal.tax_rate}%)
              </dt>
              <dd className="font-medium tabular-nums">
                {fmtUSD(Number(proposal.tax_amount))}
              </dd>
            </div>
            <div
              className="flex items-baseline justify-between pt-3 mt-1 border-t border-border"
            >
              <dt className="font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Total
              </dt>
              <dd
                className="font-heading text-3xl sm:text-4xl font-bold tabular-nums"
                style={{ color: primaryColor }}
              >
                {fmtUSD(Number(proposal.total_amount))}
              </dd>
            </div>
          </dl>
        </section>

        {/* Expired notice */}
        {data.expired && (
          <div className="rounded-xl border bg-amber-50 border-amber-200 p-6 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-600" />
            <h3 className="font-heading font-semibold text-amber-800">
              This estimate has expired
            </h3>
            <p className="text-sm text-amber-700">
              Please contact us to request an updated estimate.
            </p>
          </div>
        )}

        {/* Sign UI */}
        {!data.expired && !rejectMode && (
          <section className="border-t pt-6 space-y-5">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{ background: primaryColor }}
              >
                <PenTool className="h-4 w-4" />
              </span>
              <h3 className="font-heading text-lg font-semibold">Approve &amp; sign</h3>
            </div>

            <p className="text-sm text-muted-foreground -mt-2">
              Add your details below, then sign with your name or by drawing.
              You&rsquo;ll receive an emailed copy for your records.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name *</Label>
                <Input
                  id="name"
                  value={signedName}
                  onChange={(e) => setSignedName(e.target.value)}
                  placeholder="Your name"
                  className="h-11"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={signedEmail}
                  onChange={(e) => setSignedEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-11"
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  value={signedTitle}
                  onChange={(e) => setSignedTitle(e.target.value)}
                  placeholder="e.g. Property Manager"
                  className="h-11"
                  autoComplete="organization-title"
                />
              </div>
            </div>

            {/* Signature tabs */}
            <div className="space-y-3">
              <Label>Signature</Label>
              <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                <button
                  type="button"
                  className={`flex items-center gap-2 px-3.5 py-1.5 text-sm rounded-md transition-all ${
                    tab === 'typed'
                      ? 'bg-white shadow-sm font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setTab('typed')}
                >
                  <Type className="h-3.5 w-3.5" /> Type
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-2 px-3.5 py-1.5 text-sm rounded-md transition-all ${
                    tab === 'drawn'
                      ? 'bg-white shadow-sm font-semibold text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setTab('drawn')}
                >
                  <PenTool className="h-3.5 w-3.5" /> Draw
                </button>
              </div>

              {tab === 'typed' ? (
                <div className="rounded-xl border border-border bg-white px-4 pt-4 pb-2">
                  <div
                    className="border-b-2 border-dashed border-border py-3 px-1 text-3xl text-zinc-700 min-h-[64px] leading-tight"
                    style={{
                      fontFamily:
                        '"Brush Script MT", "Lucida Handwriting", cursive',
                    }}
                  >
                    {signedName || (
                      <span className="text-muted-foreground/60 text-base italic font-sans">
                        Type your name above &mdash; your signature appears here
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                    By typing your name, you agree this counts as your legal signature.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div
                    className="rounded-xl border-2 border-dashed border-border bg-white"
                    style={{ height: 200 }}
                  >
                    <canvas
                      ref={canvasRef}
                      className="w-full h-full touch-none cursor-crosshair rounded-xl"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground italic">
                      Sign with your finger or mouse in the box above
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearCanvas}
                    >
                      <Eraser className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="text-sm text-red-600 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {errorMsg}
              </div>
            )}

            {/* Trust strip */}
            <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg bg-muted/30 border border-border/60 px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span className="leading-5">
                Your signature is timestamped and stored securely. You&rsquo;ll
                receive an emailed copy of this approved estimate.
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-red-600 underline self-start"
                onClick={() => {
                  setRejectMode(true)
                  setErrorMsg(null)
                }}
              >
                I&apos;d like to decline this estimate
              </button>
              <Button
                onClick={submitSignature}
                disabled={submitting}
                loading={submitting}
                size="lg"
                style={{ background: primaryColor }}
                className="text-white hover:opacity-90 h-12 px-6"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Approve &amp; Sign {fmtUSD(Number(proposal.total_amount))}
              </Button>
            </div>
          </section>
        )}

        {!data.expired && rejectMode && (
          <section className="border-t pt-6 space-y-4">
            <h3 className="font-heading text-lg font-semibold flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" /> Decline estimate
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Tell us why (helps us improve)</Label>
              <Textarea
                id="reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Going with another contractor, price out of budget, etc."
                className="min-h-[100px]"
              />
            </div>
            {errorMsg && (
              <div className="text-sm text-red-600 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {errorMsg}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setRejectMode(false)
                  setErrorMsg(null)
                }}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={submitReject}
                disabled={rejectSubmitting}
                loading={rejectSubmitting}
              >
                Submit decision
              </Button>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="text-xs text-muted-foreground text-center pt-6 border-t border-border space-y-2">
          {org?.name && (
            <p className="font-medium text-foreground">{org.name}</p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {org?.company_phone && (
              <a
                href={`tel:${org.company_phone}`}
                className="hover:text-foreground transition-colors"
              >
                {org.company_phone}
              </a>
            )}
            {org?.company_email && (
              <>
                <span aria-hidden className="opacity-40">·</span>
                <a
                  href={`mailto:${org.company_email}`}
                  className="hover:text-foreground transition-colors"
                >
                  {org.company_email}
                </a>
              </>
            )}
          </div>
          <p className="pt-3 inline-flex items-center gap-1 opacity-70">
            <Sparkles className="h-3 w-3" />
            <span>
              Powered by <span className="font-medium">Pipeline AI</span>
            </span>
          </p>
        </footer>
      </div>

      {/* Floating loader during submit isn't needed — Button has its own state. */}
      {submitting && (
        <span aria-hidden className="sr-only">
          <Loader2 />
        </span>
      )}
    </div>
  )
}
