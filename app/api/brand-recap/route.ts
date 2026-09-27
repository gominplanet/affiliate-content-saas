// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/brand-recap — every Creator Connections brand the creator made
// content for, with each product and every public link, and which links a
// recap already sent (lib/brand-content-server.ts does the reads).
//
// LABS, admin only while it is tested (lib/labs-preview.ts brand_recap).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { gatherBrandRecaps } from '@/lib/brand-content-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intg } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('brand_recap', intg?.tier)) {
    return NextResponse.json({ error: 'Brand recap is still being tested.', code: 'tier_not_allowed' }, { status: 403 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  try {
    const [data, profile] = await Promise.all([
      gatherBrandRecaps(admin, ownerId),
      admin.from('brand_profiles').select('name, author_name, website_url, brand_recap_settings').eq('user_id', ownerId).maybeSingle(),
    ])
    const p = profile?.data as { name?: string; author_name?: string; website_url?: string; brand_recap_settings?: { senderName?: string; siteUrl?: string } } | null
    const sender = {
      name: p?.brand_recap_settings?.senderName || p?.author_name || p?.name || '',
      site: p?.brand_recap_settings?.siteUrl || p?.website_url || '',
    }
    return NextResponse.json({ ...data, sender })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
