/**
 * TEMPORARY: Setup test users for each role.
 * DELETE THIS FILE after testing is complete.
 *
 * POST /api/setup-test-users
 * Uses the anon key for signUp + Bogdan's session for users table insert.
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const ORG_ID = 'b0000000-0000-0000-0000-000000000001' // NYSD org

const TEST_USERS = [
  {
    email: 'bogdanmay97+superadmin@gmail.com',
    password: 'superadmin123#',
    full_name: 'Super Admin',
    role: 'super_admin',
  },
  {
    email: 'bogdanmay97+officemanager@gmail.com',
    password: 'officemanager123#',
    full_name: 'Office Manager',
    role: 'office_manager',
  },
  {
    email: 'bogdanmay97+fieldtechnician@gmail.com',
    password: 'fieldtechnician123#',
    full_name: 'Field Technician',
    role: 'field_tech',
  },
  {
    email: 'bogdanmay97+client@gmail.com',
    password: 'client123#',
    full_name: 'Test Client',
    role: 'client',
  },
]

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Try service role key first (if available), fall back to anon
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const useServiceKey = serviceKey && serviceKey !== 'placeholder'

  const cookieStore = await cookies()

  // Create admin-like client if service key available, else use session client
  let supabase
  if (useServiceKey) {
    const { createClient } = await import('@supabase/supabase-js')
    supabase = createClient(supabaseUrl, serviceKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  } else {
    supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() { /* read-only for this route */ },
      },
    })
  }

  const results = []

  for (const user of TEST_USERS) {
    try {
      let userId: string | null = null

      if (useServiceKey) {
        // Admin API — auto-confirms
        const { data, error } = await supabase.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
        })
        if (error) {
          if (error.message.includes('already been registered')) {
            // Get existing user ID
            const { data: listData } = await supabase.auth.admin.listUsers()
            const existing = listData?.users?.find((u: { email?: string }) => u.email === user.email)
            userId = existing?.id || null
            if (userId) {
              results.push({ email: user.email, status: 'already_exists_auth', id: userId })
            } else {
              results.push({ email: user.email, status: 'auth_error', error: error.message })
              continue
            }
          } else {
            results.push({ email: user.email, status: 'auth_error', error: error.message })
            continue
          }
        } else {
          userId = data.user.id
        }
      } else {
        // Anon key signUp — may need email confirmation
        const { data, error } = await supabase.auth.signUp({
          email: user.email,
          password: user.password,
        })
        if (error) {
          results.push({ email: user.email, status: 'signup_error', error: error.message })
          continue
        }
        userId = data.user?.id || null
        // Check if auto-confirmed
        const isConfirmed = !!data.user?.confirmed_at || !!data.session
        if (!isConfirmed) {
          results.push({
            email: user.email,
            status: 'needs_confirmation',
            id: userId,
            note: 'Email confirmation required. Enable "Confirm email" = OFF in Supabase Auth settings.',
          })
          // Still try to insert into users table
        }
      }

      if (!userId) {
        results.push({ email: user.email, status: 'no_user_id' })
        continue
      }

      // Insert into users table (needs owner/admin session or service role)
      // Use a separate server client with Bogdan's session for this
      const sessionClient = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll() { /* read-only */ },
        },
      })

      const { error: dbError } = await sessionClient.from('users').upsert(
        {
          id: userId,
          organization_id: ORG_ID,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          is_active: true,
        },
        { onConflict: 'id' }
      )

      if (dbError) {
        results.push({
          email: user.email,
          status: 'db_error',
          error: dbError.message,
          auth_id: userId,
        })
      } else {
        results.push({
          email: user.email,
          status: 'created',
          id: userId,
          role: user.role,
        })
      }
    } catch (err: unknown) {
      results.push({
        email: user.email,
        status: 'exception',
        error: err instanceof Error ? err.message : 'Unknown',
      })
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 1000))
  }

  return NextResponse.json({ results, method: useServiceKey ? 'service_role' : 'anon_signup' })
}
