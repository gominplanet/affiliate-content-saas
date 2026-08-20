/**
 * GET  /api/creator/affinity        → the creator's channel-fit profile (cached).
 * POST /api/creator/affinity         → force a recompute (e.g. a "refresh" button).
 *
 * The profile that powers "Made for your channel": the categories they earn in,
 * their topic keywords, and their buyers' price band — all from data we hold.
 * See lib/creator-affinity. Signed-in only.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrComputeAffinity, computeAffinity } from '@/lib/creator-affinity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getOrComputeAffinity(createAdminClient(), user.id)
  return NextResponse.json({ ok: true, profile })
}

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const profile = await computeAffinity(admin, user.id)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('creator_affinity').upsert({
      user_id: user.id, categories: profile.categories, keywords: profile.keywords,
      price_min_cents: profile.priceMinCents, price_max_cents: profile.priceMaxCents,
      sample_size: profile.sampleSize, computed_at: profile.computedAt,
    }, { onConflict: 'user_id' })
  } catch { /* pre-267 — still return the fresh profile */ }
  return NextResponse.json({ ok: true, profile })
}
