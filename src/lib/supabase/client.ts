/**
 * Supabase Browser Client
 *
 * Use this in Client Components ('use client').
 * Creates a single shared client instance for the browser.
 */
import { createBrowserClient } from '@supabase/ssr'

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

export function createClient() {
  const { url, key } = getSupabaseConfig()
  return createBrowserClient(url, key)
}
