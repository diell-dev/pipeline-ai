/**
 * GET /api/equipment/categories
 *
 * Returns all active equipment categories visible to the caller — the 15
 * global HVAC types seeded in migration 008 PLUS any org-specific categories
 * the org has added. RLS already filters by organization_id (global rows
 * where organization_id IS NULL are visible to everyone).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'

export async function GET() {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('equipment_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ categories: data || [] })
}
