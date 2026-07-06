/**
 * GET /api/books/org-brand
 *
 * Returns the current org's public branding + contact info — used by the
 * invoice paper preview to render the letterhead and by the client-side
 * PDF exporter to stamp the same header/color palette into the file.
 *
 * Only branding-safe fields go out; internal Stripe / billing columns
 * stay behind the API guard.
 */
import { NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import type { OrganizationSettings } from '@/types/database'

export interface OrgBrand {
  id: string
  name: string
  logo_url: string | null
  primary_color: string
  accent_color: string
  secondary_color: string | null
  company_phone: string | null
  company_email: string | null
  company_website: string | null
  company_address: string | null
  settings: OrganizationSettings
}

export async function GET() {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { data, error } = await supabase
    .from('organizations')
    .select(
      'id, name, logo_url, primary_color, accent_color, secondary_color, ' +
        'company_phone, company_email, company_website, company_address, settings'
    )
    .eq('id', organizationId)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Organization not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({ org: data as unknown as OrgBrand })
}
