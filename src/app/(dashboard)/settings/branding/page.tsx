'use client'

/**
 * Branding Settings — Phase H3
 *
 * Owner / super_admin can:
 *   - Upload an organization logo (Supabase Storage bucket `org-logos`)
 *   - Pick a primary and accent color (hex input, native picker, or
 *     trade-industry preset palette)
 *   - Preview the result across login, sidebar, email header,
 *     invoice/PDF header, and a primary button before saving
 *
 * Live preview strategy:
 *   We dispatch a `brand-preview` CustomEvent on the window with the
 *   in-progress colors. BrandProvider listens for this and applies the
 *   colors immediately to :root, so the whole app re-themes as you tweak
 *   the picker — without touching the database. On Save, we persist to
 *   `organizations`, then call `refreshOrganization()` which re-reads
 *   the row and pushes new values through useAuthStore → BrandProvider.
 *   (Picked refresh over a hard reload so the user stays on the page
 *   and sees the new colors confirmed.)
 *
 * Phase H3 UX additions (no behavior change to upload/save flow):
 *   - Trade-industry preset color palette (one click applies primary +
 *     accent pair)
 *   - Drag-drop logo upload zone with multi-size preview (favicon,
 *     sidebar chip, email header)
 *   - Sticky save bar showing unsaved-change count
 *   - Live preview surfaces: login split-screen, sidebar, invoice
 *     header strip, primary button, email signature
 *   - Mobile: cards stack and the sticky bar collapses to icon-only
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/client'
import {
  DEFAULT_THEME,
  getContrastingText,
  isValidHex,
  tintsFor,
} from '@/lib/theme'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Loader2,
  Upload,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Check,
  Sparkles,
  Mail,
  FileText,
  Monitor,
  LayoutDashboard,
} from 'lucide-react'
import { toast } from 'sonner'

const LOGO_BUCKET = 'org-logos'
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB

// Trade-industry palette presets. The names lean into who actually
// uses Pipeline AI (plumbing, electric, HVAC, masonry, landscape)
// so an owner can pick a paint chip that feels right without having
// to think in hex codes.
const PRESETS: Array<{ name: string; primary: string; accent: string }> = [
  { name: 'Pipeline default', primary: '#0f172a', accent: '#0369a1' },
  { name: 'Hunter green',     primary: '#14532d', accent: '#65a30d' },
  { name: 'Fire-engine red',  primary: '#7f1d1d', accent: '#dc2626' },
  { name: 'Trade navy',       primary: '#1e3a8a', accent: '#2563eb' },
  { name: 'Slate & amber',    primary: '#1f2937', accent: '#f59e0b' },
  { name: 'Dark teal',        primary: '#134e4a', accent: '#14b8a6' },
  { name: 'Charcoal & lime',  primary: '#18181b', accent: '#84cc16' },
  { name: 'Royal purple',     primary: '#3b0764', accent: '#a855f7' },
]

function normalizeForPicker(hex: string | null | undefined, fallback: string): string {
  if (!hex || !isValidHex(hex)) return fallback
  // <input type="color"> only accepts 6-char #RRGGBB
  const trimmed = hex.trim().replace(/^#/, '')
  if (trimmed.length === 3) {
    return '#' + trimmed.split('').map((c) => c + c).join('').toLowerCase()
  }
  return `#${trimmed.toLowerCase()}`
}

export default function BrandingSettingsPage() {
  const { organization, user, refreshOrganization } = useAuthStore()
  const supabase = useMemo(() => createClient(), [])

  const canEdit = user?.role ? hasPermission(user.role, 'settings:manage') : false

  // Canonical values from the org row — used to compute "dirty" state.
  const orgPrimary = normalizeForPicker(
    organization?.primary_color,
    DEFAULT_THEME.primaryColor
  )
  const orgAccent = normalizeForPicker(
    organization?.accent_color,
    DEFAULT_THEME.accentColor
  )
  const orgLogo = organization?.logo_url ?? null

  // Local form state, hydrated from the org
  const [primary, setPrimary] = useState(orgPrimary)
  const [accent, setAccent] = useState(orgAccent)
  const [logoUrl, setLogoUrl] = useState<string | null>(orgLogo)
  const [logoBroken, setLogoBroken] = useState(false)
  const [logoMeta, setLogoMeta] = useState<{ w: number; h: number; bytes: number } | null>(null)

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Re-hydrate when the org changes (e.g. after refreshOrganization or login)
  useEffect(() => {
    setPrimary(normalizeForPicker(organization?.primary_color, DEFAULT_THEME.primaryColor))
    setAccent(normalizeForPicker(organization?.accent_color, DEFAULT_THEME.accentColor))
    setLogoUrl(organization?.logo_url ?? null)
    setLogoBroken(false)
    setLogoMeta(null)
  }, [organization?.id, organization?.primary_color, organization?.accent_color, organization?.logo_url])

  // Live preview: push colors through BrandProvider whenever they change.
  useEffect(() => {
    if (!isValidHex(primary) || !isValidHex(accent)) return
    window.dispatchEvent(
      new CustomEvent('brand-preview', { detail: { primary, accent } })
    )
  }, [primary, accent])

  // On unmount, restore real org colors so leaving the page doesn't leave
  // an unsaved preview applied.
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('brand-preview', { detail: {} }))
    }
  }, [])

  // Tint preview for the primary
  const tints = useMemo(() => {
    try { return tintsFor(primary) } catch { return tintsFor(DEFAULT_THEME.primaryColor) }
  }, [primary])

  // Dirty-state tracking for the sticky save bar
  const changedFields: string[] = []
  if (primary.toLowerCase() !== orgPrimary.toLowerCase()) changedFields.push('Primary color')
  if (accent.toLowerCase() !== orgAccent.toLowerCase()) changedFields.push('Accent color')
  if ((logoUrl ?? null) !== (orgLogo ?? null)) changedFields.push('Logo')
  const dirty = changedFields.length > 0

  async function handleLogoUpload(file: File) {
    if (!organization) return
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Logo must be 2 MB or smaller')
      return
    }
    if (!/^image\//.test(file.type)) {
      toast.error('Please upload an image file (PNG, JPG, SVG)')
      return
    }

    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase()
      const path = `${organization.id}/logo-${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || 'image/png',
          cacheControl: '3600',
        })

      if (uploadErr) {
        // Graceful fall-back: bucket may not exist yet in this environment.
        const msg = uploadErr.message || 'Upload failed'
        if (/bucket|not found|does not exist/i.test(msg)) {
          toast.error(
            `Storage bucket "${LOGO_BUCKET}" missing. Ask an admin to create it as public, then try again.`
          )
        } else {
          toast.error('Logo upload failed', { description: msg })
        }
        return
      }

      const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
      const newUrl = pub?.publicUrl ?? null
      if (!newUrl) {
        toast.error('Uploaded, but could not generate public URL')
        return
      }
      setLogoUrl(newUrl)
      setLogoBroken(false)
      // Capture metadata for the size/dimensions hint
      probeLogoMeta(newUrl, file.size)
      toast.success('Logo uploaded — click Save to apply')
    } catch (err) {
      toast.error('Logo upload failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setUploading(false)
    }
  }

  // Probe the rendered image for natural dimensions so we can show
  // "320 × 80 · 24 KB" under the logo. We only do this client-side
  // for newly uploaded files — we don't refetch on hydrate to keep
  // the page snappy.
  function probeLogoMeta(url: string, bytes: number) {
    if (typeof window === 'undefined') return
    const img = new window.Image()
    img.onload = () => {
      setLogoMeta({ w: img.naturalWidth, h: img.naturalHeight, bytes })
    }
    img.onerror = () => setLogoMeta(null)
    img.src = url
  }

  async function handleSave() {
    if (!organization || !canEdit) return
    if (!isValidHex(primary) || !isValidHex(accent)) {
      toast.error('Please enter valid hex colors')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          primary_color: primary,
          accent_color: accent,
          logo_url: logoUrl,
        })
        .eq('id', organization.id)

      if (error) {
        toast.error('Failed to save branding', { description: error.message })
        return
      }

      // Re-read the org row so BrandProvider picks up the canonical values
      // (and so any subsequent reads of useAuthStore().organization are
      // in sync). See the file header for why we chose refresh over reload.
      await refreshOrganization()
      window.dispatchEvent(
        new CustomEvent('organization-updated', { detail: { primary, accent } })
      )
      toast.success('Branding saved')
    } catch (err) {
      toast.error('Failed to save branding', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setPrimary(DEFAULT_THEME.primaryColor)
    setAccent(DEFAULT_THEME.accentColor)
  }

  function handleDiscard() {
    setPrimary(orgPrimary)
    setAccent(orgAccent)
    setLogoUrl(orgLogo)
    setLogoBroken(false)
    setLogoMeta(null)
  }

  function handleApplyPreset(p: { primary: string; accent: string }) {
    setPrimary(p.primary)
    setAccent(p.accent)
  }

  // Drag-drop wiring
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleLogoUpload(file)
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!isDragging) setIsDragging(true)
  }
  function handleDragLeave() {
    setIsDragging(false)
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto pb-32">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Customize the logo and colors that brand the dashboard, login screen,
            email signatures, and invoice PDFs for your team.
          </p>
        </div>
      </div>

      {!canEdit && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            You can preview the brand settings here. Ask an Owner or Admin to make changes.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ───── Edit column ───── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Logo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Logo</span>
                {logoUrl && canEdit && (
                  <button
                    type="button"
                    onClick={() => { setLogoUrl(null); setLogoBroken(false); setLogoMeta(null) }}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Drag-drop zone */}
              <div
                onDrop={canEdit ? handleDrop : undefined}
                onDragOver={canEdit ? handleDragOver : undefined}
                onDragLeave={canEdit ? handleDragLeave : undefined}
                onClick={() => canEdit && fileInputRef.current?.click()}
                role={canEdit ? 'button' : undefined}
                tabIndex={canEdit ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!canEdit) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                className={
                  'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ' +
                  (isDragging
                    ? 'border-[var(--brand-accent,#0369a1)] bg-[var(--brand-accent,#0369a1)]/5'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600') +
                  (canEdit ? ' cursor-pointer' : ' cursor-not-allowed opacity-70')
                }
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-6 w-6 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">
                  {isDragging ? 'Drop to upload' : 'Drag a logo here, or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground">
                  PNG, JPG, SVG or WebP. Max 2 MB. Transparent backgrounds work best.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleLogoUpload(file)
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Multi-size preview */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <LogoSizePreview
                  label="Favicon"
                  size={16}
                  logoUrl={logoUrl}
                  logoBroken={logoBroken}
                  orgName={organization?.name}
                  fallbackBg={primary}
                  fallbackAccent={accent}
                />
                <LogoSizePreview
                  label="Sidebar"
                  size={32}
                  logoUrl={logoUrl}
                  logoBroken={logoBroken}
                  orgName={organization?.name}
                  fallbackBg={primary}
                  fallbackAccent={accent}
                />
                <LogoSizePreview
                  label="Email"
                  size={64}
                  logoUrl={logoUrl}
                  logoBroken={logoBroken}
                  orgName={organization?.name}
                  fallbackBg={primary}
                  fallbackAccent={accent}
                />
              </div>

              {logoBroken && (
                <p className="text-xs text-amber-600">
                  The current logo URL did not load — re-upload to fix.
                </p>
              )}
              {logoMeta && (
                <p className="text-xs text-muted-foreground">
                  {logoMeta.w} × {logoMeta.h} px · {(logoMeta.bytes / 1024).toFixed(1)} KB
                </p>
              )}

              {/* Hidden img used to detect onError for inline preview */}
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  className="hidden"
                  onError={() => setLogoBroken(true)}
                  onLoad={() => setLogoBroken(false)}
                />
              )}
            </CardContent>
          </Card>

          {/* Industry palette presets */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                Trade industry presets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESETS.map((p) => {
                  const active =
                    p.primary.toLowerCase() === primary.toLowerCase() &&
                    p.accent.toLowerCase() === accent.toLowerCase()
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => canEdit && handleApplyPreset(p)}
                      disabled={!canEdit}
                      className={
                        'group relative flex flex-col gap-2 rounded-md border p-2 text-left transition-all hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ' +
                        (active
                          ? 'border-[var(--brand-accent,#0369a1)] ring-2 ring-[var(--brand-accent,#0369a1)]/30'
                          : 'border-zinc-200 dark:border-zinc-700')
                      }
                      title={`${p.name} (${p.primary} / ${p.accent})`}
                    >
                      <div className="flex gap-1">
                        <div
                          className="h-6 flex-1 rounded"
                          style={{ backgroundColor: p.primary }}
                        />
                        <div
                          className="h-6 w-6 rounded"
                          style={{ backgroundColor: p.accent }}
                        />
                      </div>
                      <span className="text-xs font-medium leading-tight truncate">
                        {p.name}
                      </span>
                      {active && (
                        <Check className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-[var(--brand-accent,#0369a1)]" />
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Colors */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Brand colors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ColorField
                label="Primary"
                description="Sidebar, headers, and primary surfaces."
                value={primary}
                onChange={setPrimary}
                disabled={!canEdit}
              />
              <ColorField
                label="Accent"
                description="CTAs, focus rings, active nav items."
                value={accent}
                onChange={setAccent}
                disabled={!canEdit}
              />
            </CardContent>
          </Card>

          {/* Tint ramp */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Primary tints</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                {(['50','100','200','300','400','500','600','700','800','900'] as const).map((k) => (
                  <div key={k} className="space-y-1">
                    <div
                      className="h-10 rounded-md border"
                      style={{ backgroundColor: tints[k] }}
                      title={`${k} — ${tints[k]}`}
                    />
                    <p className="text-[10px] text-muted-foreground text-center font-mono">
                      {k}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ───── Live preview column ───── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Login screen preview */}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                Login screen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 rounded-lg overflow-hidden border shadow-sm">
                {/* Left panel */}
                <div
                  className="hidden sm:flex flex-col justify-between p-4 min-h-[180px]"
                  style={{
                    background: `linear-gradient(135deg, ${primary} 0%, ${tints['700']} 60%, ${accent} 130%)`,
                    color: getContrastingText(primary),
                  }}
                >
                  <div className="flex items-center gap-2">
                    {logoUrl && !logoBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="h-7 max-w-[120px] object-contain" />
                    ) : (
                      <div
                        className="h-7 w-7 rounded flex items-center justify-center text-xs font-bold"
                        style={{
                          backgroundColor: accent,
                          color: getContrastingText(accent),
                        }}
                      >
                        {organization?.name?.charAt(0) || 'P'}
                      </div>
                    )}
                    <span className="text-sm font-semibold truncate">
                      {organization?.name || 'Your Company'}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-snug">
                      Welcome back.
                    </p>
                    <p className="text-xs opacity-75">
                      Sign in to manage jobs, proposals, and invoices.
                    </p>
                  </div>
                </div>
                {/* Right panel */}
                <div className="bg-white dark:bg-zinc-900 p-4 sm:p-5 space-y-3 col-span-2 sm:col-span-1">
                  <div className="space-y-1">
                    <div className="h-2 w-12 bg-zinc-200 rounded" />
                    <div className="h-7 rounded border bg-zinc-50 dark:bg-zinc-800" />
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 w-16 bg-zinc-200 rounded" />
                    <div className="h-7 rounded border bg-zinc-50 dark:bg-zinc-800" />
                  </div>
                  <button
                    type="button"
                    className="w-full rounded-md py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                    style={{
                      backgroundColor: accent,
                      color: getContrastingText(accent),
                    }}
                  >
                    Sign in
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sidebar + primary button preview */}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                In-app sidebar &amp; button
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 rounded-lg overflow-hidden border">
                {/* Sidebar */}
                <div
                  className="col-span-1 p-3 space-y-2"
                  style={{ backgroundColor: primary, color: getContrastingText(primary) }}
                >
                  <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                    {logoUrl && !logoBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="h-6 max-w-[80px] object-contain" />
                    ) : (
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: accent, color: getContrastingText(accent) }}
                      >
                        {organization?.name?.charAt(0) || 'P'}
                      </div>
                    )}
                    <span className="text-xs font-semibold truncate">
                      {organization?.name || 'Your Co'}
                    </span>
                  </div>
                  <div
                    className="rounded-md px-2 py-1.5 text-xs font-medium"
                    style={{ backgroundColor: accent, color: getContrastingText(accent) }}
                  >
                    Dashboard
                  </div>
                  <div className="rounded-md px-2 py-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Proposals
                  </div>
                  <div className="rounded-md px-2 py-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    Jobs
                  </div>
                </div>
                {/* Content area */}
                <div className="col-span-2 p-4 bg-white dark:bg-zinc-900 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Estimate #2026-0142</p>
                    <span
                      className="text-[10px] font-medium rounded-full px-2 py-0.5"
                      style={{ backgroundColor: tints['100'], color: tints['800'] }}
                    >
                      Pending
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    How a typical card looks with your active brand colors.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                      style={{
                        backgroundColor: accent,
                        color: getContrastingText(accent),
                      }}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Primary CTA
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold border transition-colors"
                      style={{ borderColor: primary, color: primary }}
                    >
                      Secondary
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Email header + Invoice header side by side on wide screens */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email header
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden">
                  <div
                    className="p-4 flex items-center gap-3"
                    style={{ backgroundColor: primary, color: getContrastingText(primary) }}
                  >
                    {logoUrl && !logoBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="h-8 max-w-[120px] object-contain" />
                    ) : (
                      <div
                        className="h-8 w-8 rounded flex items-center justify-center text-sm font-bold"
                        style={{ backgroundColor: accent, color: getContrastingText(accent) }}
                      >
                        {organization?.name?.charAt(0) || 'P'}
                      </div>
                    )}
                    <span className="text-sm font-semibold truncate">
                      {organization?.name || 'Your Company'}
                    </span>
                  </div>
                  <div className="p-4 bg-white dark:bg-zinc-900 space-y-2 text-xs">
                    <p>Hi Sarah,</p>
                    <p className="text-muted-foreground">
                      Your invoice <strong>#2026-0142</strong> is ready to view.
                    </p>
                    <div
                      className="inline-block rounded px-3 py-1 text-xs font-semibold mt-1"
                      style={{ backgroundColor: accent, color: getContrastingText(accent) }}
                    >
                      View invoice
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Invoice / PDF header
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border overflow-hidden bg-white">
                  <div
                    className="h-2"
                    style={{ backgroundColor: accent }}
                  />
                  <div className="p-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {logoUrl && !logoBroken ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoUrl} alt="" className="h-10 max-w-[120px] object-contain" />
                      ) : (
                        <div
                          className="h-10 w-10 rounded flex items-center justify-center text-base font-bold"
                          style={{ backgroundColor: primary, color: getContrastingText(primary) }}
                        >
                          {organization?.name?.charAt(0) || 'P'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-zinc-900 truncate">
                          {organization?.name || 'Your Company'}
                        </p>
                        <p className="text-[10px] text-zinc-500">Tax ID · 1234567</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: primary }}
                      >
                        Invoice
                      </p>
                      <p className="text-sm font-mono text-zinc-700">#2026-0142</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Logo-on-dark sanity check */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo on dark surface</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="rounded-lg p-6 flex items-center justify-center min-h-[120px]"
                style={{ backgroundColor: primary }}
              >
                {logoUrl && !logoBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    className="max-h-16 max-w-[240px] object-contain"
                  />
                ) : organization?.name ? (
                  <p
                    className="text-2xl font-bold"
                    style={{ color: getContrastingText(primary) }}
                  >
                    {organization.name}
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: getContrastingText(primary), opacity: 0.7 }}>
                    Upload a logo to see it here.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reference: the current org name (helps when multi-tenant testing) */}
      <p className="text-xs text-muted-foreground">
        Editing branding for <strong>{organization?.name || 'your organization'}</strong>.
        Changes apply only to your team&apos;s view of Pipeline AI.
      </p>

      {/* ────── Sticky save bar ────── */}
      {canEdit && (
        <div
          className={
            'fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 backdrop-blur dark:bg-zinc-950/95 transition-transform ' +
            (dirty ? 'translate-y-0' : 'translate-y-full pointer-events-none')
          }
          role="region"
          aria-label="Unsaved branding changes"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-500"
                aria-hidden
              />
              <p className="text-sm font-medium truncate">
                {changedFields.length === 0
                  ? 'No unsaved changes'
                  : `${changedFields.length} unsaved change${changedFields.length === 1 ? '' : 's'}`}
              </p>
              <p className="hidden sm:block text-xs text-muted-foreground truncate">
                {changedFields.join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDiscard}
                disabled={saving || !dirty}
                className="hidden sm:inline-flex"
              >
                Discard
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={saving}
                title="Reset to Pipeline AI default colors"
              >
                <RotateCcw className="sm:mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Defaults</span>
              </Button>
              <Button
                variant="brand"
                size="sm"
                onClick={handleSave}
                disabled={saving || !dirty}
              >
                {saving ? (
                  <><Loader2 className="sm:mr-2 h-4 w-4 animate-spin" /><span className="hidden sm:inline">Saving…</span></>
                ) : (
                  <><Save className="sm:mr-2 h-4 w-4" /><span className="hidden sm:inline">Save changes</span></>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

/**
 * Tiny preview of how the logo renders at a target render size.
 * If no logo is uploaded, shows the "P" chip fallback at the same
 * size so the user can sanity-check the brand-color chip too.
 */
function LogoSizePreview({
  label,
  size,
  logoUrl,
  logoBroken,
  orgName,
  fallbackBg,
  fallbackAccent,
}: {
  label: string
  size: number
  logoUrl: string | null
  logoBroken: boolean
  orgName: string | undefined
  fallbackBg: string
  fallbackAccent: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-md border bg-zinc-50 dark:bg-zinc-900 p-3">
      <div
        className="flex items-center justify-center bg-white dark:bg-zinc-800 rounded shadow-sm overflow-hidden"
        style={{ height: Math.max(size, 24), width: Math.max(size, 24) }}
      >
        {logoUrl && !logoBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="object-contain"
            style={{ maxHeight: size, maxWidth: size }}
          />
        ) : (
          <div
            className="flex items-center justify-center font-bold rounded"
            style={{
              height: size,
              width: size,
              backgroundColor: fallbackBg,
              color: getContrastingText(fallbackBg),
              borderRadius: Math.max(2, size * 0.15),
              fontSize: Math.max(8, size * 0.5),
            }}
          >
            <span style={{ color: getContrastingText(fallbackBg) }}>
              {orgName?.charAt(0) || 'P'}
            </span>
            {/* tiny chip showing accent below for very small sizes is overkill;
                accent shown via the chip background only at sidebar+ sizes */}
            {size >= 32 && (
              <span
                className="absolute"
                style={{
                  height: Math.max(4, size * 0.16),
                  width: Math.max(4, size * 0.16),
                  backgroundColor: fallbackAccent,
                  borderRadius: '9999px',
                  transform: `translate(${size * 0.32}px, ${size * 0.32}px)`,
                }}
                aria-hidden
              />
            )}
          </div>
        )}
      </div>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground font-mono">
        {size}px
      </span>
    </div>
  )
}

function ColorField({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [text, setText] = useState(value)

  useEffect(() => { setText(value) }, [value])

  function commitText(v: string) {
    if (isValidHex(v)) {
      const normalized = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`
      onChange(normalized.toLowerCase())
    }
  }

  return (
    <div className="space-y-2">
      <Label className="font-medium">{label}</Label>
      <div className="flex items-center gap-3">
        <label
          className="relative h-11 w-14 shrink-0 rounded-md border overflow-hidden cursor-pointer focus-within:ring-2 focus-within:ring-ring"
          style={{ backgroundColor: value }}
          aria-label={`${label} color picker`}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitText((e.target as HTMLInputElement).value)
            }
          }}
          disabled={disabled}
          placeholder="#000000"
          className="font-mono w-32 h-11 uppercase"
          maxLength={7}
        />
        <p className="text-xs text-muted-foreground flex-1 hidden sm:block">{description}</p>
      </div>
      <p className="text-xs text-muted-foreground sm:hidden">{description}</p>
    </div>
  )
}
