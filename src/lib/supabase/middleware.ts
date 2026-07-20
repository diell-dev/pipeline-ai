/**
 * Supabase Middleware Client
 *
 * Used in Next.js middleware to refresh auth sessions on every request.
 * This ensures cookies stay fresh and users don't get logged out unexpectedly.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }

  return { url, key }
}

/** Pages (NOT api routes) that don't require authentication */
const PUBLIC_ROUTES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/proposals/sign',
  '/equipment/qr',
  '/pay',
] as const

/**
 * S8 — how long an emailed temporary password stays usable.
 * After this window the session is terminated on the next request and the
 * user has to go through the normal password-reset email flow.
 */
const TEMP_PASSWORD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * API path prefixes that are public by design — they authenticate themselves
 * (Stripe webhook signature, public proposal token, cron bearer token, etc.).
 * The middleware must NOT redirect these to /login; the route handlers return
 * proper JSON errors when their own auth fails.
 */
const PUBLIC_API_PREFIXES = [
  '/api/stripe/webhook',
  '/api/proposals/public/',
  '/api/internal/cron/',
] as const

export interface SessionOptions {
  /** Per-request CSP nonce (audit S9) — forwarded to the app via request headers. */
  nonce?: string
  /** The full CSP string; Next.js reads it off the REQUEST to nonce its own scripts. */
  csp?: string
}

export async function updateSession(request: NextRequest, options: SessionOptions = {}) {
  const { url, key } = getSupabaseConfig()

  // Propagate the nonce + policy onto the request headers so the React render
  // pass (and Next's own bootstrap scripts) can pick them up.
  const requestHeaders = new Headers(request.headers)
  if (options.nonce) requestHeaders.set('x-nonce', options.nonce)
  if (options.csp) requestHeaders.set('Content-Security-Policy', options.csp)

  const nextWithHeaders = () =>
    NextResponse.next({ request: { headers: requestHeaders } })

  let supabaseResponse = nextWithHeaders()

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = nextWithHeaders()
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh the session — this is critical for keeping the user logged in
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route))

  // ── S8: forced password change for invited accounts ──
  // The invite routes stamp `must_change_password` into the user's JWT
  // app_metadata (service-role only — a user cannot set it themselves), so
  // this check costs nothing extra: no DB query, the claim is already on the
  // session we just refreshed above.
  if (user) {
    const meta = (user.app_metadata ?? {}) as {
      must_change_password?: boolean
      password_set_at?: string
    }

    if (meta.must_change_password === true) {
      const issuedAt = meta.password_set_at ? Date.parse(meta.password_set_at) : NaN
      const expired =
        Number.isFinite(issuedAt) && Date.now() - issuedAt > TEMP_PASSWORD_MAX_AGE_MS

      if (expired) {
        // The emailed temp password outlived its window. Kill the session and
        // send them through the normal reset flow — an unused credential
        // sitting in an inbox must not stay valid forever.
        await supabase.auth.signOut()
        const url = request.nextUrl.clone()
        url.pathname = '/forgot-password'
        url.searchParams.set('reason', 'temp-expired')
        return NextResponse.redirect(url)
      }

      // Allow the change-password screen itself, its API, sign-out, and static
      // assets through; everything else redirects there.
      const allowed =
        pathname.startsWith('/change-password') ||
        pathname.startsWith('/api/account/change-password') ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/_next')

      if (!allowed) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            { error: 'You must set a new password before continuing.' },
            { status: 403 }
          )
        }
        const url = request.nextUrl.clone()
        url.pathname = '/change-password'
        url.search = ''
        return NextResponse.redirect(url)
      }
    }
  }
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))
  // ALL /api/* routes handle their own auth via getApiUser; never redirect
  // them to /login — they should return JSON errors. The middleware still
  // refreshes the user session above so cookie-bound API routes Just Work.
  const isApiRoute = pathname.startsWith('/api/')

  // Redirect unauthenticated PAGE users to login. API routes return JSON.
  if (!user && !isPublicRoute && !isApiRoute && !pathname.startsWith('/change-password')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from auth pages (login/register etc.)
  // but NOT away from the public /proposals/sign/*, /equipment/qr/*,
  // /reset-password, or public APIs.
  if (
    user &&
    isPublicRoute &&
    !pathname.startsWith('/proposals/sign') &&
    !pathname.startsWith('/equipment/qr') &&
    !pathname.startsWith('/reset-password') &&
    !isPublicApi
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
