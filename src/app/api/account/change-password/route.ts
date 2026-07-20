/**
 * POST /api/account/change-password
 *
 * Sets a new password for the CURRENT user and clears the S8
 * "must_change_password" state in both places it lives:
 *   - auth.users.app_metadata (the JWT claim middleware enforces)
 *   - public.users.must_change_password / password_set_at (reporting + UI)
 *
 * Why a server route instead of calling supabase.auth.updateUser() straight
 * from the browser: app_metadata is deliberately NOT writable by the user's
 * own token (that's what makes the forced-change gate meaningful). Only the
 * service role can clear it, so the clearing has to happen server-side.
 *
 * Body: { newPassword: string, currentPassword?: string }
 *   currentPassword is REQUIRED for a normal voluntary change (defence
 *   against an unattended-session takeover). It is not required when the
 *   account is in the forced-change state — that user already proved
 *   possession of the temp password by signing in, and forcing them to
 *   retype it adds nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'
import { enforceRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const MIN_PASSWORD_LENGTH = 12

/**
 * Free-tier stand-in for Supabase's Pro-only leaked-password check (audit S5).
 * Not a breach-corpus lookup — just refuses the obvious garbage that a
 * breach list would have caught anyway.
 */
const WEAK_PATTERNS = [
  /^password/i,
  /^12345/,
  /^qwerty/i,
  /^letmein/i,
  /^welcome/i,
  /^admin/i,
  /^pipeline/i,
]

function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (pw.length > 200) return 'Password is too long.'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Password must include an uppercase letter, a lowercase letter, and a number.'
  }
  if (WEAK_PATTERNS.some((re) => re.test(pw))) {
    return 'That password is too easy to guess. Please choose something less common.'
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (!(await enforceRateLimit(`change-password:${auth.userId}`, { limit: 5, windowMs: 60_000 }))) {
      return NextResponse.json({ error: 'Too many attempts — please wait a minute.' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      newPassword?: string
      currentPassword?: string
    }
    const newPassword = body.newPassword ?? ''

    const invalid = validatePassword(newPassword)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

    const supabase = await createClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    if (!authUser?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const meta = (authUser.app_metadata ?? {}) as { must_change_password?: boolean }
    const forced = meta.must_change_password === true

    // Voluntary change → re-authenticate with the current password first.
    if (!forced) {
      const currentPassword = body.currentPassword ?? ''
      if (!currentPassword) {
        return NextResponse.json({ error: 'Your current password is required.' }, { status: 400 })
      }
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: currentPassword,
      })
      if (reauthError) {
        return NextResponse.json({ error: 'Your current password is incorrect.' }, { status: 403 })
      }
    }

    if (newPassword === body.currentPassword) {
      return NextResponse.json(
        { error: 'Please choose a password different from your current one.' },
        { status: 400 }
      )
    }

    // Update the password on the user's OWN session.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    // Clear the forced-change state. Service role required for app_metadata.
    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (serviceUrl && serviceKey) {
      const admin = createServiceClient(serviceUrl, serviceKey)
      const nowIso = new Date().toISOString()
      await admin.auth.admin.updateUserById(authUser.id, {
        app_metadata: { must_change_password: false, password_set_at: nowIso },
      })
      await admin
        .from('users')
        .update({ must_change_password: false, password_set_at: nowIso })
        .eq('id', authUser.id)
    } else if (forced) {
      // Without the service key we cannot clear the JWT claim, which would
      // trap the user in a redirect loop. Better to fail loudly.
      console.error('SUPABASE_SERVICE_ROLE_KEY missing — cannot clear must_change_password')
      return NextResponse.json(
        { error: 'Server is not fully configured. Please contact support.' },
        { status: 503 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Change password error:', err)
    return NextResponse.json({ error: 'Could not change your password.' }, { status: 500 })
  }
}
