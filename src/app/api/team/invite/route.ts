/**
 * POST /api/team/invite
 *
 * Creates a new user in the organization.
 * Uses the Supabase service role client to create the auth user,
 * then inserts into the users table.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, apiHasPermission } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ──
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'users:invite')) {
      return NextResponse.json({ error: 'You do not have permission to invite users' }, { status: 403 })
    }

    const body = await req.json()
    const { full_name, email, phone, role } = body
    // Force organization_id from the authenticated user's org (ignore client-sent value)
    const organization_id = auth.organizationId

    if (!full_name || !email || !role) {
      return NextResponse.json(
        { error: 'Missing required fields: full_name, email, role' },
        { status: 400 }
      )
    }

    // Only allow inviting field_tech and office_manager
    if (!['field_tech', 'office_manager'].includes(role)) {
      return NextResponse.json(
        { error: 'Can only invite field_tech or office_manager roles' },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server configuration error: missing service role key' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Check if email already exists in users table
    const { data: existing } = await supabase
      .from('users')
      .select('id, is_active')
      .eq('email', email.toLowerCase())
      .eq('organization_id', organization_id)
      .single()

    if (existing) {
      if (existing.is_active) {
        return NextResponse.json(
          { error: 'A team member with this email already exists' },
          { status: 409 }
        )
      }
      // Re-activate if previously deactivated
      const { data: reactivated, error: reactivateError } = await supabase
        .from('users')
        .update({ is_active: true, full_name, phone: phone || null, role })
        .eq('id', existing.id)
        .select()
        .single()

      if (reactivateError) throw reactivateError

      return NextResponse.json({ success: true, user: reactivated, reactivated: true })
    }

    // Generate a temporary password
    // Generate a strong temporary password (24 chars, mixed case + numbers + symbols)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
    const tempPassword = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password: tempPassword,
      email_confirm: true,
    })

    if (authError) {
      // If user already exists in auth but not in users table
      if (authError.message.includes('already been registered')) {
        return NextResponse.json(
          { error: 'This email is already registered. Contact support if this is unexpected.' },
          { status: 409 }
        )
      }
      throw authError
    }

    // Insert into users table
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        id: authData.user.id,
        organization_id,
        email: email.toLowerCase(),
        full_name,
        role,
        phone: phone || null,
        is_active: true,
      })
      .select()
      .single()

    if (userError) throw userError

    return NextResponse.json({
      success: true,
      user: newUser,
      tempPassword, // In production, this would be emailed instead
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Team invite error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
