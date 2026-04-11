/**
 * TEMPORARY: Setup test users for each role.
 * DELETE THIS FILE after testing is complete.
 *
 * POST /api/setup-test-users
 * Creates Supabase Auth users and matching users table records.
 */
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const TEST_USERS = [
  {
    email: 'superadmin@pipeline-ai.test',
    password: 'superadmin123#',
    full_name: 'Super Admin',
    role: 'super_admin',
    org_id: 'a0000000-0000-0000-0000-000000000001', // Pipeline AI org
  },
  {
    email: 'officemanager@pipeline-ai.test',
    password: 'officemanager123#',
    full_name: 'Office Manager',
    role: 'office_manager',
    org_id: 'b0000000-0000-0000-0000-000000000001', // NYSD org
  },
  {
    email: 'fieldtechnician@pipeline-ai.test',
    password: 'fieldtechnician123#',
    full_name: 'Field Technician',
    role: 'field_tech',
    org_id: 'b0000000-0000-0000-0000-000000000001', // NYSD org
  },
  {
    email: 'client@pipeline-ai.test',
    password: 'client123#',
    full_name: 'Test Client User',
    role: 'client',
    org_id: 'b0000000-0000-0000-0000-000000000001', // NYSD org
  },
]

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Missing SUPABASE_SERVICE_ROLE_KEY env var' },
      { status: 500 }
    )
  }

  // Admin client with service role key — bypasses RLS
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const results = []

  for (const user of TEST_USERS) {
    try {
      // 1. Create auth user
      const { data: authData, error: authError } =
        await supabase.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true, // auto-confirm
        })

      if (authError) {
        // If user already exists, try to get their ID
        if (authError.message.includes('already been registered')) {
          const { data: existingUsers } =
            await supabase.auth.admin.listUsers()
          const existing = existingUsers?.users?.find(
            (u) => u.email === user.email
          )
          if (existing) {
            results.push({
              email: user.email,
              status: 'already_exists',
              id: existing.id,
            })
            continue
          }
        }
        results.push({
          email: user.email,
          status: 'auth_error',
          error: authError.message,
        })
        continue
      }

      const userId = authData.user.id

      // 2. Insert into users table
      const { error: dbError } = await supabase.from('users').upsert(
        {
          id: userId,
          organization_id: user.org_id,
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
        continue
      }

      results.push({
        email: user.email,
        status: 'created',
        id: userId,
        role: user.role,
      })
    } catch (err: unknown) {
      results.push({
        email: user.email,
        status: 'exception',
        error: err instanceof Error ? err.message : 'Unknown',
      })
    }
  }

  return NextResponse.json({ results })
}
