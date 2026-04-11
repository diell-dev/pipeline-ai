import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/** Skip static generation — this page needs runtime auth checks */
export const dynamic = 'force-dynamic'

/**
 * Root page — redirects to dashboard if logged in, or login if not.
 */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
