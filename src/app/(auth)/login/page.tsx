'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--brand-primary,#05093d)] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* Logo placeholder — will be dynamic per org */}
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--brand-primary,#05093d)]">
            <span className="text-lg font-bold text-[var(--brand-accent,#00ff85)]">P</span>
          </div>
          <CardTitle className="text-2xl font-bold">Pipeline AI</CardTitle>
          <CardDescription>
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/forgot-password" className="hover:underline">
              Forgot your password?
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
