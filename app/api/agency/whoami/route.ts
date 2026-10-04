// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/agency/whoami  { isVa, ownerId, ownerEmail, canPublish }
//
// Lets a page tell a Virtual Assistant whose account they are working in, and
// whether they may publish through it (lib/agency-publish). An owner gets
// { isVa: false }.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAgencyContext, hasPermission } from '@/lib/agency'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const ctx = await resolveAgencyContext(user.id)
  if (ctx.effectiveOwnerUserId === user.id) return NextResponse.json({ isVa: false, canPublish: true })
  let ownerEmail: string | null = null
  try {
    const { data } = await createAdminClient().auth.admin.getUserById(ctx.effectiveOwnerUserId)
    ownerEmail = data?.user?.email ?? null
  } catch { /* the page says "the account owner" instead */ }
  return NextResponse.json({ isVa: true, ownerId: ctx.effectiveOwnerUserId, ownerEmail, canPublish: hasPermission(ctx, 'publish_to_socials') })
}
