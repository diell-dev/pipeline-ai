/**
 * SECURITY: This endpoint has been disabled.
 * It was a temporary test-user setup utility — DELETE THIS FILE from the repo.
 *
 * To delete: git rm src/app/api/setup-test-users/route.ts
 */
import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
