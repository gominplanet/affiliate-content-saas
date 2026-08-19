/**
 * GET /api/pulse/summary — data for the Pulse panel.
 *
 * Returns the caller's own tag performance (best + underperformers) and, for the
 * niches they post in, how the same tags rank across ALL MVP creators. Read-only.
 * Everything is aggregate (tag → mean lift); no other user's posts or numbers are
 * ever exposed.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { personalTagStats, pooledTagStats, collectedSampleCount, bestPostingTimes } from '@/lib/pulse-rank'

export const runtime = 'nodejs'

// Below this many collected posts the personal ranking is noise — show a
// "still learning" state instead of crowning tags off 1-2 posts.
const MIN_FOR_PERSONAL = 4

export async function GET(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The client passes its Date.getTimezoneOffset() so best-times read in the
  // creator's own clock (bounded to a sane range; defaults to UTC).
  const tzRaw = Number(new URL(request.url).searchParams.get('tz'))
  const tzOffsetMinutes = Number.isFinite(tzRaw) && Math.abs(tzRaw) <= 840 ? tzRaw : 0

  const sampleCount = await collectedSampleCount(user.id)

  // The niches this creator has actually posted in (top 2 by volume) — so the
  // pooled view is relevant, not a global mush.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: nicheRows } = await admin
    .from('reach_samples')
    .select('niche')
    .eq('user_id', user.id)
    .not('niche', 'is', null)
    .limit(500)
  const nicheCounts = new Map<string, number>()
  for (const r of (nicheRows ?? []) as Array<{ niche: string | null }>) {
    if (r.niche) nicheCounts.set(r.niche, (nicheCounts.get(r.niche) ?? 0) + 1)
  }
  const topNiches = [...nicheCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n)

  const [personal, pooled, bestTimes] = await Promise.all([
    sampleCount >= MIN_FOR_PERSONAL ? personalTagStats(user.id) : Promise.resolve([]),
    Promise.all(topNiches.map(async (niche) => ({
      niche,
      tags: (await pooledTagStats(niche)).slice(0, 8),
    }))),
    bestPostingTimes(user.id, tzOffsetMinutes),
  ])

  return NextResponse.json({
    collecting: sampleCount < MIN_FOR_PERSONAL,
    sampleCount,
    minForPersonal: MIN_FOR_PERSONAL,
    personalTop: personal.filter(t => t.avgLift >= 1).slice(0, 8),
    personalBottom: personal.filter(t => t.avgLift < 1).slice(-5).reverse(),
    pooled: pooled.filter(p => p.tags.length > 0),
    bestTimes,
  })
}
