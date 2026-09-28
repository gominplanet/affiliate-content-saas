// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon-videos/read-products — read the next slice of the creator's
// Amazon videos' products from their public pages (lib/amazon-video-products),
// on MVP's server, for about 40 seconds, and say what happened.
//
// Brand recap calls it in a loop while its page is open; the cron
// (/api/cron/amazon-video-products) does the same with no page open.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { readVideoProducts } from '@/lib/amazon-video-products'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return auth.error
  const { ownerId } = auth as { ownerId: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { count: total } = await admin.from('amazon_videos').select('aci', { count: 'exact', head: true }).eq('user_id', ownerId)
  const run = await readVideoProducts(admin, ownerId, { budgetMs: 40_000, concurrency: 4 })
  return NextResponse.json({ ok: !run.error, total: total ?? null, ...run })
}
