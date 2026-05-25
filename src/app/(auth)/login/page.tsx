'use client'

/**
 * Login Page — Phase E1
 *
 * Split-screen layout: branded value-prop panel on the left, login form on
 * the right. Stacks vertically on mobile (panel collapses to a compact
 * header strip). Uses Phase A+B tokens for color and Phase C component
 * conventions (44px touch-target inputs, Loader-free button via the
 * `loading` prop). Subtle Phase F entrance animation via `.page-fade-in`.
 *
 * Auth: email+password is the default. A "Email me a magic link"
 * alternative is offered too — Supabase's `signInWithOtp` flow uses the
 * same email-link redirect mechanism the password reset already relies on,
 * so no extra callback wiring is required (the @supabase/ssr browser
 * client picks up the session from the URL hash on /login next load).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Activity,
  CheckCircle2,
  Mail,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

type Mode = 'password' | 'magic'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      toast.error('Login failed', {
        description: error.message,
      })
      setIsLoading(false)
      return
    }

    toast.success('Welcome back!')
    router.push('/dashboard')
    router.refresh()
  }

  async function handleMagicSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      toast.error('Enter your email first')
      return
    }
    setIsLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo:
            typeof window !== 'undefined'
              ? `${window.location.origin}/dashboard`
              : undefined,
        },
      })
      if (error) {
        toast.error('Could not send magic link', { description: error.message })
        setIsLoading(false)
        return
      }
      setMagicSent(true)
      toast.success('Check your email')
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* ── Brand panel (left on desktop, header strip on mobile) ── */}
      <aside
        className="relative overflow-hidden text-white lg:w-1/2 lg:min-h-screen"
        style={{
          background:
            'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)',
        }}
      >
        {/* Subtle decorative grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />
        {/* Soft top-right glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'rgb(255 255 255 / 0.4)' }}
        />

        <div className="relative flex h-full flex-col p-6 sm:p-10 lg:p-14">
          {/* Logo / wordmark */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
              <span className="font-heading text-lg font-bold">P</span>
            </div>
            <span className="font-heading text-lg font-semibold tracking-tight">
              Pipeline AI
            </span>
          </div>

          {/* Value prop — visible on lg+ */}
          <div className="hidden lg:flex flex-1 flex-col justify-center max-w-lg mt-12">
            <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/70">
              <Sparkles className="h-3.5 w-3.5" />
              Field service operations, modernised
            </p>
            <h1 className="font-heading mt-4 text-4xl xl:text-5xl font-bold tracking-tight leading-[1.05]">
              Field service operations that don&rsquo;t lose track.
            </h1>
            <p className="mt-5 text-base text-white/80 leading-relaxed">
              From the first estimate to the final invoice — jobs,
              proposals, equipment, and finances stay in sync, so nothing
              slips through the cracks.
            </p>

            <ul className="mt-10 space-y-4">
              {[
                {
                  icon: Zap,
                  text: 'One-tap workflows for the field crew',
                },
                {
                  icon: Activity,
                  text: 'Real-time dashboards for the office',
                },
                {
                  icon: ShieldCheck,
                  text: 'Customer-signed estimates with audit trail',
                },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm text-white/90">
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="leading-6">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Mobile value-prop line */}
          <p className="lg:hidden mt-2 text-sm text-white/80">
            Field service operations that don&rsquo;t lose track.
          </p>
        </div>
      </aside>

      {/* ── Form panel ── */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8 lg:py-16">
        <div className="w-full max-w-md page-fade-in">
          <div className="mb-8">
            <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground">
              {mode === 'magic' ? 'Sign in with email' : 'Welcome back'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === 'magic'
                ? "We'll email you a one-time link — no password needed."
                : 'Sign in to your account to continue.'}
            </p>
          </div>

          {magicSent ? (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-heading text-base font-semibold text-foreground">
                    Check your inbox
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We sent a sign-in link to{' '}
                    <strong className="text-foreground">{email}</strong>. Open
                    it on this device to continue.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-5 w-full h-11"
                onClick={() => {
                  setMagicSent(false)
                  setMode('password')
                }}
              >
                Use a password instead
              </Button>
            </div>
          ) : (
            <form
              onSubmit={mode === 'password' ? handlePasswordSubmit : handleMagicSubmit}
              className="space-y-5"
            >
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              {mode === 'password' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium">
                      Password
                    </Label>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="h-11"
                  />
                </div>
              )}

              <Button
                type="submit"
                variant="brand"
                className="w-full h-11"
                loading={isLoading}
              >
                {mode === 'magic' ? (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Email me a sign-in link
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background px-3 text-muted-foreground">
                    or
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full h-11"
                disabled={isLoading}
                onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
              >
                {mode === 'magic' ? (
                  'Sign in with password'
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Email me a magic link
                  </>
                )}
              </Button>
            </form>
          )}

          {/* Footer */}
          <div className="mt-10 flex flex-col items-center gap-3 text-xs text-muted-foreground">
            <p>Powered by Pipeline AI</p>
            <div className="flex items-center gap-4">
              <Link href="#" className="hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <span aria-hidden className="h-3 w-px bg-border" />
              <Link href="#" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
