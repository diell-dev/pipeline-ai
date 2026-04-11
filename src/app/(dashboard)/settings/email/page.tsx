'use client'

/**
 * Email Integration Settings
 *
 * Allows the Owner to configure email sending for reports/invoices.
 * Options:
 *   1. Resend API (default) — send from a custom domain
 *   2. Future: Google OAuth / Outlook OAuth one-click connect
 *
 * For now, this page lets the owner set:
 *   - From email address for reports
 *   - Reply-to email
 *   - Email footer text
 *   - Test email functionality
 */
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

interface EmailSettings {
  from_email: string
  reply_to: string
  email_footer: string
  email_provider: 'resend' | 'smtp' | 'none'
}

export default function EmailSettingsPage() {
  const router = useRouter()
  const { user, organization } = useAuthStore()
  const canManage = user?.role ? hasPermission(user.role, 'settings:manage') : false

  const [settings, setSettings] = useState<EmailSettings>({
    from_email: '',
    reply_to: '',
    email_footer: '',
    email_provider: 'none',
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Load current settings
  useEffect(() => {
    async function load() {
      if (!organization?.id) return
      const supabase = createClient()
      const { data } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', organization.id)
        .single()

      if (data?.settings) {
        const s = data.settings as Record<string, unknown>
        setSettings({
          from_email: (s.from_email as string) || '',
          reply_to: (s.reply_to as string) || '',
          email_footer: (s.email_footer as string) || '',
          email_provider: (s.email_provider as EmailSettings['email_provider']) || 'none',
        })
      }
      setLoaded(true)
    }
    load()
  }, [organization?.id])

  async function handleSave() {
    if (!organization?.id) return
    setSaving(true)

    try {
      const supabase = createClient()

      // Get current settings to merge
      const { data: current } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', organization.id)
        .single()

      const currentSettings = (current?.settings as Record<string, unknown>) || {}

      const { error } = await supabase
        .from('organizations')
        .update({
          settings: {
            ...currentSettings,
            from_email: settings.from_email,
            reply_to: settings.reply_to,
            email_footer: settings.email_footer,
            email_provider: settings.email_provider,
          },
        })
        .eq('id', organization.id)

      if (error) throw error
      toast.success('Email settings saved')
    } catch (err) {
      console.error('Save failed:', err)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestEmail() {
    if (!testEmail) {
      toast.error('Enter an email address to send a test')
      return
    }
    setTesting(true)

    try {
      // Just send a test via the API
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      })

      if (res.ok) {
        toast.success(`Test email sent to ${testEmail}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to send test email')
      }
    } catch {
      toast.error('Failed to send test email')
    } finally {
      setTesting(false)
    }
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <h3 className="text-lg font-semibold">Access Restricted</h3>
            <p className="text-sm text-muted-foreground">
              Only owners can manage email settings.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Settings</h1>
          <p className="text-muted-foreground text-sm">
            Configure how reports and invoices are emailed to clients.
          </p>
        </div>
      </div>

      {/* Current Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            {settings.email_provider !== 'none' ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm text-green-700">Email is configured</span>
                <Badge className="bg-green-100 text-green-700 ml-2">
                  {settings.email_provider === 'resend' ? 'Resend' : 'SMTP'}
                </Badge>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span className="text-sm text-amber-700">
                  Email not fully configured — reports will be logged but not sent
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            To enable email sending, set the <code className="bg-zinc-100 px-1 rounded">RESEND_API_KEY</code> environment
            variable in your Vercel project settings. Get a free API key at{' '}
            <a href="https://resend.com" target="_blank" rel="noopener" className="text-blue-600 underline">
              resend.com
            </a>.
          </p>
        </CardContent>
      </Card>

      {/* Email Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Email Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="from_email">From Email</Label>
            <Input
              id="from_email"
              type="email"
              placeholder="reports@nysewerdrain.com"
              value={settings.from_email}
              onChange={(e) => setSettings({ ...settings, from_email: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              The email address reports will be sent from. Must be verified in your email provider.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reply_to">Reply-To Email</Label>
            <Input
              id="reply_to"
              type="email"
              placeholder="office@nysewerdrain.com"
              value={settings.reply_to}
              onChange={(e) => setSettings({ ...settings, reply_to: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              When clients reply to a report email, it goes to this address.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email_footer">Email Footer Text</Label>
            <Textarea
              id="email_footer"
              placeholder="NY Sewer & Drain Inc. | Licensed & Insured | (555) 123-4567"
              value={settings.email_footer}
              onChange={(e) => setSettings({ ...settings, email_footer: e.target.value })}
              className="min-h-[60px]"
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Test Email */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Send className="h-4 w-4" /> Send Test Email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="your@email.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleTestEmail} disabled={testing} variant="outline">
              {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sends a sample report email to verify your configuration is working.
          </p>
        </CardContent>
      </Card>

      {/* Future: OAuth integrations */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            Coming Soon: One-Click Email Connect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect your Google Workspace or Microsoft 365 account to send reports
            directly from your business email — no API keys needed.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" disabled className="opacity-50">
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Connect Google
            </Button>
            <Button variant="outline" disabled className="opacity-50">
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                <path fill="#0078D4" d="M24 12c0-6.627-5.373-12-12-12S0 5.373 0 12s5.373 12 12 12 12-5.373 12-12zm-5.196-4.328H12.85v8.656h2.07V13.12h2.874l.507-2.058h-3.38v-1.175c0-.596.165-.882.94-.882h2.44V7.672z"/>
              </svg>
              Connect Outlook
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
