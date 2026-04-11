/**
 * Supabase Middleware Client
 *
 * Used in Next.js middleware to refresh auth sessions on every request.
 * This ensures cookies stay fresh and users don't get logged out unexpectedly.
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  )

  // Refresh the session — this is critical for keeping the user logged in
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Define public routes that don't require auth
  const publicRoutes = ['/login', '/register', '/forgot-password']
  const isPublicRoute = publicRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // Redirect unauthenticated users to login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from auth pages
  if (user && isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
