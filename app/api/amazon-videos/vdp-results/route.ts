// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon-videos/vdp-results { results: [{ id, state, asins }] }
//
// What SCOUT read from the creator's Amazon video pages, from their own
// connection, when Amazon robot-checks MVP's server (lib/amazon-video-products
// recordVideoReads). Only the creator's own unread videos are touched.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { recordVideoReads } from '@/lib/amazon-video-products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { ownerId } = auth as { ownerId: string }
  const body = await request.json().catch(() => ({})) as { results?: Array<{ id: string; state: string; asins?: string[] }> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const r = await recordVideoReads(admin, ownerId, Array.isArray(body.results) ? body.results : [])
  const { count } = await admin.from('amazon_videos').select('aci', { count: 'exact', head: true }).eq('user_id', ownerId).is('products_synced_at', null)
  return NextResponse.json({ ok: !r.error, ...r, remaining: typeof count === 'number' ? count : null })
}
