// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Pulse — the ranking side (read).
 *
 * Turns collected reach_samples into tag rankings by attributing each post's
 * `lift` (how far it beat the poster's own baseline) to every hashtag it used.
 * Over many posts, tags that keep riding high-lift posts float to the top.
 *
 *   • personalTagStats — this user's own history
 *   • pooledTagStats   — across ALL users, sliced by niche (the network effect)
 *
 * Attribution is co-occurrence: a row's lift counts for each of its tags. Tags
 * co-occur so this isn't causal proof, but with volume it's a sound signal, and
 * we gate on a minimum sample count so a single lucky post can't crown a tag.
 *
 * Reads run through the service-role admin client (pooled ranking must see every
 * user's rows); callers decide what to expose. Nothing user-identifying is ever
 * returned — only tag → aggregate lift.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export interface TagStat {
  tag: string
  samples: number
  /** Mean lift across posts that used this tag. 1.0 = average; >1 beats baseline. */
  avgLift: number
}

interface SampleRow { hashtags: string[] | null; lift: number | null }

function aggregate(rows: SampleRow[], minSamples: number): TagStat[] {
  const liftsByTag = new Map<string, number[]>()
  for (const r of rows) {
    if (r.lift == null || !Number.isFinite(r.lift)) continue
    for (const raw of r.hashtags || []) {
      const tag = String(raw || '').toLowerCase()
      if (!tag || tag === '#ad') continue
      const arr = liftsByTag.get(tag)
      if (arr) arr.push(r.lift)
      else liftsByTag.set(tag, [r.lift])
    }
  }
  const out: TagStat[] = []
  for (const [tag, lifts] of liftsByTag) {
    if (lifts.length < minSamples) continue
    out.push({ tag, samples: lifts.length, avgLift: lifts.reduce((a, b) => a + b, 0) / lifts.length })
  }
  return out.sort((a, b) => b.avgLift - a.avgLift)
}

/** This user's tags ranked by their own average lift. */
export async function personalTagStats(userId: string, minSamples = 2): Promise<TagStat[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('reach_samples')
    .select('hashtags,lift')
    .eq('user_id', userId)
    .eq('status', 'collected')
    .not('lift', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(500)
  return aggregate((data ?? []) as SampleRow[], minSamples)
}

/** Tags ranked across ALL users for a niche (null = every niche pooled). */
export async function pooledTagStats(niche: string | null, minSamples = 5): Promise<TagStat[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let q = admin
    .from('reach_samples')
    .select('hashtags,lift')
    .eq('status', 'collected')
    .not('lift', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(2000)
  if (niche) q = q.eq('niche', niche)
  const { data } = await q
  return aggregate((data ?? []) as SampleRow[], minSamples)
}

/** Count of a user's collected samples — drives the panel's "still collecting" state. */
export async function collectedSampleCount(userId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { count } = await admin
    .from('reach_samples')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'collected')
  return count ?? 0
}
