/**
 * Supabase Browser Client
 *
 * Use this in Client Components ('use client').
 * Creates a single shared client instance for the browser.
 */
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
