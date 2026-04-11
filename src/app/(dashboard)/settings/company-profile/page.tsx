'use client'

/**
 * Company Profile Settings
 *
 * Comprehensive settings page combining:
 * - Company info (phone, email, website, address)
 * - Logo upload
 * - Brand colors (primary, accent, secondary)
 * - Invoice theme selector (4 modern themes)
 * - Header/Footer builder (3 pillars with placement options)
 *
 * All changes here affect future generated invoices and reports.
 */
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Building,
  Upload,
  Loader2,
  Save,
  Phone,
  Mail,
  Globe,
  MapPin,
  Palette,
  FileText,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Check,
  X,
  Hash,
} from 'lucide-react'
import type {
  InvoiceTheme,
  DocPillarType,
  DocPillarAlignment,
  DocHeaderFooterLayout,
  OrganizationSettings,
} from '@/types/database'

// ===== INVOICE THEME PREVIEWS =====
const INVOICE_THEMES: {
  id: InvoiceTheme
  name: string
  description: string
  preview: { headerBg: string; accentLine: string; bodyStyle: string }
}[] = [
  {
    id: 'modern',
    name: 'Modern',
    description: 'Clean lines, bold header with company color, sans-serif typography',
    preview: { headerBg: 'bg-zinc-900', accentLine: 'bg-blue-500', bodyStyle: 'Clean & minimal' },
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'Traditional layout, subtle borders, professional serif accents',
    preview: { headerBg: 'bg-zinc-700', accentLine: 'bg-zinc-400', bodyStyle: 'Traditional' },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Whitespace-heavy, thin dividers, lightweight feel',
    preview: { headerBg: 'bg-white border', accentLine: 'bg-zinc-200', bodyStyle: 'Airy & light' },
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Large colored blocks, strong contrasts, impactful design',
    preview: { headerBg: 'bg-blue-600', accentLine: 'bg-yellow-400', bodyStyle: 'High contrast' },
  },
]

const PILLAR_TYPES: { value: DocPillarType; label: string; icon: typeof ImageIcon }[] = [
  { value: 'logo', label: 'Logo', icon: ImageIcon },
  { value: 'company_info', label: 'Company Info', icon: Building },
  { value: 'page_number', label: 'Page Number', icon: Hash },
  { value: 'empty', label: 'Empty', icon: X },
]

const DEFAULT_HEADER: DocHeaderFooterLayout = {
  left: { type: 'logo', alignment: 'left' },
  center: { type: 'empty', alignment: 'center' },
  right: { type: 'company_info', alignment: 'right' },
}

const DEFAULT_FOOTER: DocHeaderFooterLayout = {
  left: { type: 'company_info', alignment: 'left' },
  center: { type: 'page_number', alignment: 'center' },
  right: { type: 'empty', alignment: 'right' },
}

// ===== PILLAR EDITOR COMPONENT =====
function PillarEditor({
  label,
  pillar,
  onChange,
}: {
  label: string
  pillar: { type: DocPillarType; alignment: DocPillarAlignment }
  onChange: (updated: { type: DocPillarType; alignment: DocPillarAlignment }) => void
}) {
  return (
    <div className="space-y-2 p-3 border rounded-lg bg-zinc-50/50">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>

      {/* Type selector */}
      <div className="flex flex-wrap gap-1">
        {PILLAR_TYPES.map((pt) => {
          const Icon = pt.icon
          const isActive = pillar.type === pt.value
          return (
            <button
              key={pt.value}
              onClick={() => onChange({ ...pillar, type: pt.value })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                isActive
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white border hover:bg-zinc-100 text-zinc-600'
              }`}
            >
              <Icon className="h-3 w-3" />
              {pt.label}
            </button>
          )
        })}
      </div>

      {/* Alignment */}
      {pillar.type !== 'empty' && (
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as DocPillarAlignment[]).map((a) => {
            const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
            return (
              <button
                key={a}
                onClick={() => onChange({ ...pillar, alignment: a })}
                className={`p-1.5 rounded transition-colors ${
                  pillar.alignment === a
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white border hover:bg-zinc-100 text-zinc-500'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ===== MAIN PAGE =====
export default function CompanyProfilePage() {
  const { organization, updateOrganization } = useAuthStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Company info
  const [companyName, setCompanyName] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [companyWebsite, setCompanyWebsite] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')

  // Branding
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#05093d')
  const [accentColor, setAccentColor] = useState('#00ff85')
  const [secondaryColor, setSecondaryColor] = useState('')

  // Document settings
  const [invoiceTheme, setInvoiceTheme] = useState<InvoiceTheme>('modern')
  const [header, setHeader] = useState<DocHeaderFooterLayout>(DEFAULT_HEADER)
  const [footer, setFooter] = useState<DocHeaderFooterLayout>(DEFAULT_FOOTER)

  // Initialize from org data
  useEffect(() => {
    if (!organization) return
    setCompanyName(organization.name || '')
    setCompanyPhone(organization.company_phone || '')
    setCompanyEmail(organization.company_email || '')
    setCompanyWebsite(organization.company_website || '')
    setCompanyAddress(organization.company_address || '')
    setLogoUrl(organization.logo_url || null)
    setPrimaryColor(organization.primary_color || '#05093d')
    setAccentColor(organization.accent_color || '#00ff85')
    setSecondaryColor(organization.secondary_color || '')

    const settings = (organization.settings || {}) as OrganizationSettings
    setInvoiceTheme(settings.invoice_theme || 'modern')
    setHeader(settings.header || DEFAULT_HEADER)
    setFooter(settings.footer || DEFAULT_FOOTER)
  }, [organization])

  // Upload logo
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !organization) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2MB')
      return
    }

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() || 'png'
      const path = `${organization.id}/logo.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('company-assets')
        .upload(path, file, { upsert: true })

      if (uploadError) throw uploadError

      const { data: urlData } = supabase.storage
        .from('company-assets')
        .getPublicUrl(path)

      // Add cache-bust
      const newUrl = `${urlData.publicUrl}?t=${Date.now()}`
      setLogoUrl(newUrl)

      // Save to DB immediately
      await supabase
        .from('organizations')
        .update({ logo_url: urlData.publicUrl })
        .eq('id', organization.id)

      toast.success('Logo uploaded')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      console.error('Logo upload error:', msg)
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  // Save all settings
  async function handleSave() {
    if (!organization) return
    setSaving(true)

    try {
      const supabase = createClient()

      const settings: OrganizationSettings = {
        invoice_theme: invoiceTheme,
        header,
        footer,
      }

      const { error } = await supabase
        .from('organizations')
        .update({
          name: companyName.trim(),
          company_phone: companyPhone.trim() || null,
          company_email: companyEmail.trim() || null,
          company_website: companyWebsite.trim() || null,
          company_address: companyAddress.trim() || null,
          primary_color: primaryColor,
          accent_color: accentColor,
          secondary_color: secondaryColor.trim() || null,
          settings,
        })
        .eq('id', organization.id)

      if (error) throw error

      // Update auth store
      updateOrganization({
        name: companyName.trim(),
        company_phone: companyPhone.trim() || null,
        company_email: companyEmail.trim() || null,
        company_website: companyWebsite.trim() || null,
        company_address: companyAddress.trim() || null,
        primary_color: primaryColor,
        accent_color: accentColor,
        secondary_color: secondaryColor.trim() || null,
        settings,
      })

      toast.success('Company profile saved! Future documents will use these settings.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      console.error('Save error:', msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Company Profile</h1>
        <p className="text-muted-foreground">
          Your company details, branding, and document settings. Changes apply to all future invoices and reports.
        </p>
      </div>

      {/* ======== SECTION 1: Company Info ======== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building className="h-4 w-4" /> Company Information
          </CardTitle>
          <CardDescription>Basic details shown on invoices, reports, and emails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company_name">Company Name</Label>
            <Input
              id="company_name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="New York Sewer & Drain"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company_phone" className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> Phone
              </Label>
              <Input
                id="company_phone"
                type="tel"
                value={companyPhone}
                onChange={(e) => setCompanyPhone(e.target.value)}
                placeholder="(212) 555-0100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company_email" className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> Email
              </Label>
              <Input
                id="company_email"
                type="email"
                value={companyEmail}
                onChange={(e) => setCompanyEmail(e.target.value)}
                placeholder="info@nysd.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company_website" className="flex items-center gap-1">
                <Globe className="h-3 w-3" /> Website
              </Label>
              <Input
                id="company_website"
                value={companyWebsite}
                onChange={(e) => setCompanyWebsite(e.target.value)}
                placeholder="www.nysd.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company_address" className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Address
              </Label>
              <Input
                id="company_address"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="123 Main St, New York, NY 10001"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ======== SECTION 2: Logo & Colors ======== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4" /> Logo & Brand Colors
          </CardTitle>
          <CardDescription>Your logo and colors appear on all generated documents.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo */}
          <div className="flex items-start gap-6">
            <div className="shrink-0">
              {logoUrl ? (
                <div className="h-24 w-24 rounded-lg border overflow-hidden bg-zinc-50">
                  <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain" />
                </div>
              ) : (
                <div className="h-24 w-24 rounded-lg border-2 border-dashed bg-zinc-50 flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-zinc-300" />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Company Logo</p>
              <p className="text-xs text-muted-foreground">
                PNG or JPG, max 2MB. Square or wide format recommended.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Upload className="h-3.5 w-3.5 mr-1" />
                )}
                {logoUrl ? 'Replace Logo' : 'Upload Logo'}
              </Button>
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">Primary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Accent Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="font-mono text-sm"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Secondary Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondaryColor || '#666666'}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="font-mono text-sm"
                  placeholder="#666666"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Color preview */}
          <div className="flex gap-2">
            <div
              className="h-8 flex-1 rounded"
              style={{ backgroundColor: primaryColor }}
            />
            <div
              className="h-8 flex-1 rounded"
              style={{ backgroundColor: accentColor }}
            />
            <div
              className="h-8 flex-1 rounded"
              style={{ backgroundColor: secondaryColor || '#666666' }}
            />
          </div>
        </CardContent>
      </Card>

      {/* ======== SECTION 3: Invoice Theme ======== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Invoice Theme
          </CardTitle>
          <CardDescription>Choose how your invoices look when sent to clients as PDFs.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {INVOICE_THEMES.map((theme) => {
              const isSelected = invoiceTheme === theme.id
              return (
                <button
                  key={theme.id}
                  onClick={() => setInvoiceTheme(theme.id)}
                  className={`relative border-2 rounded-lg overflow-hidden transition-all text-left ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  {/* Mini preview */}
                  <div className="aspect-[3/4] p-2 space-y-1.5">
                    <div className={`h-6 rounded-sm ${theme.preview.headerBg}`} />
                    <div className={`h-0.5 ${theme.preview.accentLine}`} />
                    <div className="space-y-1">
                      <div className="h-1.5 bg-zinc-200 rounded-full w-3/4" />
                      <div className="h-1.5 bg-zinc-100 rounded-full w-full" />
                      <div className="h-1.5 bg-zinc-100 rounded-full w-5/6" />
                      <div className="h-1.5 bg-zinc-100 rounded-full w-2/3" />
                    </div>
                    <div className="h-1.5 bg-zinc-200 rounded-full w-1/3 mt-2" />
                  </div>

                  {/* Label */}
                  <div className="px-2 pb-2">
                    <p className="text-xs font-semibold">{theme.name}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{theme.description}</p>
                  </div>

                  {/* Check mark */}
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 h-5 w-5 bg-blue-500 rounded-full flex items-center justify-center">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ======== SECTION 4: Header & Footer Builder ======== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Document Header & Footer
          </CardTitle>
          <CardDescription>
            Configure what appears in the header and footer of your PDFs. Each section is divided into three pillars
            — left, center, and right — where you can place your logo, company info, or page numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-xs">Header</Badge>
              <span className="text-xs text-muted-foreground">Top of every page</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <PillarEditor
                label="Left"
                pillar={header.left}
                onChange={(p) => setHeader({ ...header, left: p })}
              />
              <PillarEditor
                label="Center"
                pillar={header.center}
                onChange={(p) => setHeader({ ...header, center: p })}
              />
              <PillarEditor
                label="Right"
                pillar={header.right}
                onChange={(p) => setHeader({ ...header, right: p })}
              />
            </div>
          </div>

          {/* Visual preview */}
          <div className="border rounded-lg overflow-hidden">
            <div className="text-[10px] text-center text-muted-foreground bg-zinc-50 py-0.5 border-b">
              Preview
            </div>
            {/* Header preview */}
            <div className="px-4 py-2 border-b flex items-center justify-between text-xs bg-white">
              <PreviewPillar pillar={header.left} logoUrl={logoUrl} companyName={companyName} />
              <PreviewPillar pillar={header.center} logoUrl={logoUrl} companyName={companyName} />
              <PreviewPillar pillar={header.right} logoUrl={logoUrl} companyName={companyName} />
            </div>
            {/* Body placeholder */}
            <div className="px-4 py-6 space-y-2">
              <div className="h-2 bg-zinc-100 rounded w-1/2" />
              <div className="h-2 bg-zinc-50 rounded w-full" />
              <div className="h-2 bg-zinc-50 rounded w-4/5" />
              <div className="h-2 bg-zinc-50 rounded w-3/5" />
            </div>
            {/* Footer preview */}
            <div className="px-4 py-2 border-t flex items-center justify-between text-xs bg-white">
              <PreviewPillar pillar={footer.left} logoUrl={logoUrl} companyName={companyName} />
              <PreviewPillar pillar={footer.center} logoUrl={logoUrl} companyName={companyName} />
              <PreviewPillar pillar={footer.right} logoUrl={logoUrl} companyName={companyName} />
            </div>
          </div>

          {/* Footer */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-xs">Footer</Badge>
              <span className="text-xs text-muted-foreground">Bottom of every page</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <PillarEditor
                label="Left"
                pillar={footer.left}
                onChange={(p) => setFooter({ ...footer, left: p })}
              />
              <PillarEditor
                label="Center"
                pillar={footer.center}
                onChange={(p) => setFooter({ ...footer, center: p })}
              />
              <PillarEditor
                label="Right"
                pillar={footer.right}
                onChange={(p) => setFooter({ ...footer, right: p })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ======== SAVE BUTTON ======== */}
      <div className="flex items-center gap-3 pb-8">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Company Profile
        </Button>
        <p className="text-xs text-muted-foreground">
          Changes will apply to all future invoices and reports.
        </p>
      </div>
    </div>
  )
}

// ===== PREVIEW PILLAR (for the live preview) =====
function PreviewPillar({
  pillar,
  logoUrl,
  companyName,
}: {
  pillar: { type: DocPillarType; alignment: DocPillarAlignment }
  logoUrl: string | null
  companyName: string
}) {
  const alignClass =
    pillar.alignment === 'left'
      ? 'text-left'
      : pillar.alignment === 'center'
        ? 'text-center'
        : 'text-right'

  if (pillar.type === 'empty') {
    return <div className="flex-1" />
  }

  if (pillar.type === 'logo') {
    return (
      <div className={`flex-1 ${alignClass}`}>
        {logoUrl ? (
          <img src={logoUrl} alt="Logo" className="h-6 inline-block object-contain" />
        ) : (
          <span className="text-[10px] text-zinc-300 italic">Logo</span>
        )}
      </div>
    )
  }

  if (pillar.type === 'company_info') {
    return (
      <div className={`flex-1 ${alignClass}`}>
        <span className="text-[10px] text-zinc-500 font-medium">{companyName || 'Company Name'}</span>
      </div>
    )
  }

  if (pillar.type === 'page_number') {
    return (
      <div className={`flex-1 ${alignClass}`}>
        <span className="text-[10px] text-zinc-400">Page 1</span>
      </div>
    )
  }

  return <div className="flex-1" />
}
