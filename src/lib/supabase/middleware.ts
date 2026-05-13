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
const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/proposals/sign'] as const

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

export async function updateSession(request: NextRequest) {
  const { url, key } = getSupabaseConfig()

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({
          request,
        })
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
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))
  // ALL /api/* routes handle their own auth via getApiUser; never redirect
  // them to /login — they should return JSON errors. The middleware still
  // refreshes the user session above so cookie-bound API routes Just Work.
  const isApiRoute = pathname.startsWith('/api/')

  // Redirect unauthenticated PAGE users to login. API routes return JSON.
  if (!user && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from auth pages (login/register etc.)
  // but NOT away from the public /proposals/sign/* or public APIs.
  if (
    user &&
    isPublicRoute &&
    !pathname.startsWith('/proposals/sign') &&
    !isPublicApi
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
