'use client'

/**
 * Branding Settings
 *
 * Owner / super_admin can:
 *   - Upload an organization logo (Supabase Storage bucket `org-logos`)
 *   - Pick a primary and accent color
 *   - Preview the result live before saving
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
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { Loader2, Upload, ImageOff, Save, RotateCcw, Plus } from 'lucide-react'
import { toast } from 'sonner'

const LOGO_BUCKET = 'org-logos'
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB

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

  // Local form state, hydrated from the org
  const [primary, setPrimary] = useState(
    normalizeForPicker(organization?.primary_color, DEFAULT_THEME.primaryColor)
  )
  const [accent, setAccent] = useState(
    normalizeForPicker(organization?.accent_color, DEFAULT_THEME.accentColor)
  )
  const [logoUrl, setLogoUrl] = useState<string | null>(organization?.logo_url ?? null)
  const [logoBroken, setLogoBroken] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Re-hydrate when the org changes (e.g. after refreshOrganization or login)
  useEffect(() => {
    setPrimary(normalizeForPicker(organization?.primary_color, DEFAULT_THEME.primaryColor))
    setAccent(normalizeForPicker(organization?.accent_color, DEFAULT_THEME.accentColor))
    setLogoUrl(organization?.logo_url ?? null)
    setLogoBroken(false)
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
      toast.success('Logo uploaded — click Save to apply')
    } catch (err) {
      toast.error('Logo upload failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setUploading(false)
    }
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

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Customize the logo and colors that brand the dashboard for your team.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset} disabled={saving}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to default
            </Button>
            <Button variant="brand" onClick={handleSave} disabled={saving}>
              {saving ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                <><Save className="mr-2 h-4 w-4" />Save changes</>
              )}
            </Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            You can preview the brand settings here. Ask an Owner or Admin to make changes.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ───── Edit column ───── */}
        <div className="space-y-6">
          {/* Logo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border bg-white overflow-hidden"
                  aria-label="Current logo preview"
                >
                  {logoUrl && !logoBroken ? (
                    // Plain <img> so we don't have to whitelist arbitrary
                    // tenant storage domains in next.config.ts.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="max-h-16 max-w-16 object-contain"
                      onError={() => setLogoBroken(true)}
                    />
                  ) : (
                    <ImageOff className="h-6 w-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="space-y-2 flex-1 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleLogoUpload(file)
                      // Reset so the same filename can be re-uploaded
                      e.target.value = ''
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canEdit || uploading}
                  >
                    {uploading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</>
                    ) : (
                      <><Upload className="mr-2 h-4 w-4" />Upload logo</>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG, SVG or WebP. Max 2 MB. Transparent backgrounds work best.
                  </p>
                  {logoUrl && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive underline"
                      onClick={() => { setLogoUrl(null); setLogoBroken(false) }}
                      disabled={!canEdit}
                    >
                      Remove logo
                    </button>
                  )}
                  {logoBroken && (
                    <p className="text-xs text-amber-600">
                      The current logo URL did not load — re-upload to fix.
                    </p>
                  )}
                </div>
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
                description="Used for the sidebar, headers, and primary calls-to-action."
                value={primary}
                onChange={setPrimary}
                disabled={!canEdit}
              />
              <ColorField
                label="Accent"
                description="Used for highlights, active nav items, and secondary accents."
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
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Live preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mock header bar */}
              <div
                className="rounded-lg p-4 flex items-center justify-between"
                style={{
                  backgroundColor: primary,
                  color: getContrastingText(primary),
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {logoUrl && !logoBroken ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-8 max-w-[140px] object-contain rounded bg-white/10 p-1"
                    />
                  ) : (
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center font-bold text-sm"
                      style={{
                        backgroundColor: accent,
                        color: getContrastingText(accent),
                      }}
                    >
                      {organization?.name?.charAt(0) || 'P'}
                    </div>
                  )}
                  <span className="font-semibold truncate">
                    {organization?.name || 'Your Company'}
                  </span>
                </div>
                <span
                  className="text-xs rounded px-2 py-1"
                  style={{
                    backgroundColor: accent,
                    color: getContrastingText(accent),
                  }}
                >
                  Active
                </span>
              </div>

              {/* Mock card */}
              <div className="rounded-lg border bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Estimate #2026-0142</p>
                  <span
                    className="text-xs font-medium rounded-full px-2 py-0.5"
                    style={{
                      backgroundColor: tints['100'],
                      color: tints['800'],
                    }}
                  >
                    Pending
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  This is how a typical card will look with the active brand colors applied.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90"
                    style={{
                      backgroundColor: primary,
                      color: getContrastingText(primary),
                    }}
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Primary CTA
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium border transition-colors"
                    style={{
                      borderColor: primary,
                      color: primary,
                    }}
                  >
                    Secondary
                  </button>
                </div>
              </div>

              {/* Mock sidebar nav item */}
              <div className="rounded-lg overflow-hidden border">
                <div
                  className="px-3 py-2 text-sm"
                  style={{
                    backgroundColor: primary,
                    color: getContrastingText(primary),
                  }}
                >
                  <p className="font-medium opacity-90">Sidebar preview</p>
                </div>
                <div className="p-2 space-y-1" style={{ backgroundColor: primary }}>
                  <div
                    className="rounded-md px-3 py-2 text-sm font-medium"
                    style={{
                      backgroundColor: accent,
                      color: getContrastingText(accent),
                    }}
                  >
                    Dashboard (active)
                  </div>
                  <div
                    className="rounded-md px-3 py-2 text-sm"
                    style={{ color: 'rgba(255,255,255,0.7)' }}
                  >
                    Proposals
                  </div>
                  <div
                    className="rounded-md px-3 py-2 text-sm"
                    style={{ color: 'rgba(255,255,255,0.7)' }}
                  >
                    Jobs
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Logo on dark</CardTitle>
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

    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

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
        <p className="text-xs text-muted-foreground flex-1">{description}</p>
      </div>
    </div>
  )
}
