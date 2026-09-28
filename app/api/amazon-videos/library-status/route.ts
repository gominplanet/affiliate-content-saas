// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon-videos/library-status — how current MVP's copy of the
// creator's Amazon video list is: how many videos, when the list was last
// read, and how many still wait for their products. Brand recap reads it to
// decide whether to have SCOUT check the list for new videos.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { ownerId } = auth as { ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [tot, last, unread] = await Promise.all([
    sb.from('amazon_videos').select('aci', { count: 'exact', head: true }).eq('user_id', ownerId),
    sb.from('amazon_videos').select('synced_at').eq('user_id', ownerId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('amazon_videos').select('aci', { count: 'exact', head: true }).eq('user_id', ownerId).is('products_synced_at', null),
  ])
  return NextResponse.json({
    total: tot.count ?? 0,
    lastReadAt: (last.data as { synced_at?: string } | null)?.synced_at ?? null,
    unread: unread.count ?? 0,
  })
}
