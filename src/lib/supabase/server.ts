/**
 * Supabase Server Client
 *
 * Use this in Server Components, Server Actions, and Route Handlers.
 * Creates a new client per request (required for proper cookie handling).
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

export async function createClient() {
  const { url, key } = getSupabaseConfig()
  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // The `setAll` method is called from a Server Component.
          // This can be ignored if middleware refreshes sessions.
        }
      },
    },
  })
}
