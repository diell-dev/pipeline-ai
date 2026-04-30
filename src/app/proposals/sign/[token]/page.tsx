'use client'

/**
 * Public Proposal Sign Page (no auth)
 *
 * Loads /api/proposals/public/[token], shows the client-facing estimate,
 * and lets the customer e-sign (drawn or typed) or reject with a reason.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  PenTool,
  Type,
  Eraser,
} from 'lucide-react'

interface PublicProposal {
  id: string
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

    // Set internal pixel size matching CSS size for crisp lines
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
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
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
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setRejectSubmitting(false)
    }
  }

  // ── Render states ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data || (errorMsg && !data)) {
    return (
      <div className="max-w-xl mx-auto py-24 px-4">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500 mb-3" />
            <h1 className="text-xl font-bold mb-2">Estimate Not Available</h1>
            <p className="text-sm text-muted-foreground">
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
  const primaryColor = org?.primary_color || '#1e3a5f'
  const totallyDone =
    success ||
    rejected ||
    data.already_signed ||
    data.already_rejected ||
    proposal.status === 'converted_to_job'

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Branded header */}
      <div
        className="rounded-t-2xl text-white p-6 shadow-md"
        style={{ background: primaryColor }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {org?.logo_url ? (
              <img
                src={org.logo_url}
                alt={org.name}
                className="max-h-12 max-w-[180px] object-contain bg-white/10 rounded p-1"
              />
            ) : (
              <h1 className="text-xl font-bold">{org?.name || 'Service Estimate'}</h1>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs opacity-80">Estimate</p>
            <p className="text-sm font-mono">{proposal.proposal_number}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-b-2xl shadow-md p-6 sm:p-8 space-y-6">
        {/* Greeting */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Estimate for {proposal.client?.company_name || 'Your Property'}
          </h2>
          {proposal.site?.address && (
            <p className="text-sm text-muted-foreground mt-1">{proposal.site.address}</p>
          )}
          {proposal.valid_until && (
            <p className="text-xs text-muted-foreground mt-2">
              Valid through{' '}
              {new Date(proposal.valid_until).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          )}
        </div>

        {/* Issue */}
        <section>
          <h3
            className="text-sm uppercase tracking-wide font-semibold mb-2"
            style={{ color: primaryColor }}
          >
            The Issue
          </h3>
          <p className="text-sm leading-6 whitespace-pre-wrap">{proposal.issue_description}</p>
        </section>

        {/* Proposed Solution */}
        <section>
          <h3
            className="text-sm uppercase tracking-wide font-semibold mb-2"
            style={{ color: primaryColor }}
          >
            Proposed Solution
          </h3>
          <p className="text-sm leading-6 whitespace-pre-wrap">{proposal.proposed_solution}</p>
        </section>

        {/* Line items */}
        {data.line_items && data.line_items.length > 0 && (
          <section>
            <h3
              className="text-sm uppercase tracking-wide font-semibold mb-2"
              style={{ color: primaryColor }}
            >
              Services
            </h3>
            <div className="border rounded-lg overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-zinc-600">Item</th>
                    <th className="text-center px-3 py-2 font-medium text-zinc-600">Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-zinc-600">Price</th>
                    <th className="text-right px-3 py-2 font-medium text-zinc-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.line_items.map((li) => (
                    <tr key={li.id} className="border-t">
                      <td className="px-3 py-2">
                        <p className="font-medium">{li.service_name}</p>
                        {li.description && (
                          <p className="text-xs text-muted-foreground">{li.description}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">{li.quantity}</td>
                      <td className="px-3 py-2 text-right">{fmtUSD(Number(li.unit_price))}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {fmtUSD(Number(li.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Totals */}
        <section className="border-t pt-4 text-right space-y-1">
          <p className="text-sm">
            <span className="text-muted-foreground">Subtotal:</span>{' '}
            <strong>{fmtUSD(Number(proposal.subtotal))}</strong>
          </p>
          {proposal.discount_enabled && Number(proposal.discount_amount) > 0 && (
            <p className="text-sm text-muted-foreground">
              Discount{proposal.discount_reason ? ` (${proposal.discount_reason})` : ''}:{' '}
              <strong className="text-red-600">−{fmtUSD(Number(proposal.discount_amount))}</strong>
            </p>
          )}
          <p className="text-sm">
            <span className="text-muted-foreground">Tax ({proposal.tax_rate}%):</span>{' '}
            <strong>{fmtUSD(Number(proposal.tax_amount))}</strong>
          </p>
          <p className="text-2xl font-bold pt-2" style={{ color: primaryColor }}>
            Total: {fmtUSD(Number(proposal.total_amount))}
          </p>
        </section>

        {/* Done states */}
        {totallyDone && (
          <div className="rounded-xl border bg-green-50 border-green-200 p-6 text-center space-y-2">
            <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" />
            <h3 className="text-lg font-semibold text-green-800">
              {success || data.already_signed
                ? 'Thank you — estimate signed!'
                : rejected || data.already_rejected
                ? 'You declined this estimate'
                : 'This estimate is complete'}
            </h3>
            <p className="text-sm text-green-700">
              {success || data.already_signed
                ? "We've received your approval. Our team will reach out shortly to schedule the work."
                : 'We appreciate the time you took to review. Reach out anytime if anything changes.'}
            </p>
          </div>
        )}

        {/* Sign UI */}
        {!totallyDone && data.expired && (
          <div className="rounded-xl border bg-amber-50 border-amber-200 p-6 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-600" />
            <h3 className="font-semibold text-amber-800">This estimate has expired</h3>
            <p className="text-sm text-amber-700">
              Please contact us to request an updated estimate.
            </p>
          </div>
        )}

        {!totallyDone && !data.expired && !rejectMode && (
          <section className="border-t pt-6 space-y-4">
            <h3 className="text-lg font-semibold">Approve &amp; Sign</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  value={signedName}
                  onChange={(e) => setSignedName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={signedEmail}
                  onChange={(e) => setSignedEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  value={signedTitle}
                  onChange={(e) => setSignedTitle(e.target.value)}
                  placeholder="e.g. Property Manager"
                />
              </div>
            </div>

            {/* Signature tabs */}
            <div className="space-y-3">
              <Label>Signature</Label>
              <div className="inline-flex border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className={`flex items-center gap-2 px-4 py-2 text-sm ${
                    tab === 'typed' ? 'bg-zinc-100 font-semibold' : 'hover:bg-zinc-50'
                  }`}
                  onClick={() => setTab('typed')}
                >
                  <Type className="h-4 w-4" /> Type your name
                </button>
                <button
                  type="button"
                  className={`flex items-center gap-2 px-4 py-2 text-sm border-l ${
                    tab === 'drawn' ? 'bg-zinc-100 font-semibold' : 'hover:bg-zinc-50'
                  }`}
                  onClick={() => setTab('drawn')}
                >
                  <PenTool className="h-4 w-4" /> Draw signature
                </button>
              </div>

              {tab === 'typed' ? (
                <div
                  className="border-b border-dashed py-4 px-2 text-3xl font-serif italic text-zinc-700 min-h-[60px]"
                  style={{ fontFamily: '"Brush Script MT", "Lucida Handwriting", cursive' }}
                >
                  {signedName || 'Your signature will appear here'}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="border rounded-lg bg-white" style={{ height: 200 }}>
                    <canvas
                      ref={canvasRef}
                      className="w-full h-full touch-none cursor-crosshair"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="ghost" size="sm" onClick={clearCanvas}>
                      <Eraser className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="text-sm text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> {errorMsg}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
              <button
                type="button"
                className="text-sm text-zinc-500 hover:text-red-600 underline self-start"
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
                size="lg"
                style={{ background: primaryColor }}
                className="text-white hover:opacity-90"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Signing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Approve &amp; Sign Estimate
                  </>
                )}
              </Button>
            </div>
          </section>
        )}

        {!totallyDone && !data.expired && rejectMode && (
          <section className="border-t pt-6 space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" /> Decline Estimate
            </h3>
            <div className="space-y-1">
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
              <div className="text-sm text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> {errorMsg}
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
              >
                {rejectSubmitting ? 'Submitting…' : 'Submit Rejection'}
              </Button>
            </div>
          </section>
        )}

        <footer className="text-xs text-muted-foreground text-center pt-6 border-t">
          {org?.name && <p>{org.name}</p>}
          {org?.company_phone && <p>{org.company_phone}</p>}
          {org?.company_email && <p>{org.company_email}</p>}
        </footer>
      </div>
    </div>
  )
}
