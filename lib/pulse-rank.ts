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

/**
 * The blended list of proven tags to inject into a fresh caption, most-earning
 * first. Personal winners lead (your audience is specific), pooled-per-niche
 * winners fill the rest (the network effect gives new creators proven tags on
 * day one). Only tags meaningfully above baseline (lift ≥ 1.1) qualify.
 *
 * Deliberately small (default 3): the caption engine still adds the brand tag,
 * broad category tags, and AI-written specifics around these, so fresh tags keep
 * getting trialled — that's the exploration that keeps the data honest and stops
 * the whole platform collapsing onto the same handful of tags. And because the
 * rankings are computed over RECENT posts, a tag whose lift fades drops out on
 * its own (decay). Best-effort: returns [] on any error, never blocks a caption.
 */
export async function pulseTrendingTags(userId: string, niche: string | null, max = 3): Promise<string[]> {
  try {
    const [personal, pooled] = await Promise.all([
      personalTagStats(userId, 2),
      pooledTagStats(niche, 5),
    ])
    const winners = (arr: TagStat[]) => arr.filter(t => t.avgLift >= 1.1).map(t => t.tag)
    const out: string[] = []
    const seen = new Set<string>()
    const add = (t: string) => {
      const x = String(t || '').toLowerCase()
      if (x && !seen.has(x)) { seen.add(x); out.push(x) }
    }
    for (const t of winners(personal)) { if (out.length >= max) break; add(t) }
    for (const t of winners(pooled)) { if (out.length >= max) break; add(t) }
    return out.slice(0, max)
  } catch {
    return []
  }
}

// ── Best time to post ────────────────────────────────────────────────────────
// The SAME reach_samples we score tags on also carry posted_at + lift, so we can
// learn WHEN this creator's posts overperform — no new data collection. We group
// each post's lift by weekday and by hour (shifted into the creator's local time
// via the tz offset the client passes) and surface the windows that keep beating
// their baseline. Gated on a minimum sample count so a couple of lucky posts
// can't crown a time slot.

export interface TimeBucket { key: number; avgLift: number; samples: number }
export interface BestTimes {
  samples: number
  bestWeekday: TimeBucket | null
  bestHour: TimeBucket | null
  topWindows: Array<{ weekday: number; hour: number; avgLift: number; samples: number }>
  byWeekday: TimeBucket[]  // all 7, weekday 0=Sun (0 samples allowed)
}

interface TimedRow { posted_at: string | null; lift: number | null }

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length

/**
 * Learn this creator's best posting windows from their collected reach samples.
 * `tzOffsetMinutes` is the client's Date.getTimezoneOffset() (minutes BEHIND UTC,
 * e.g. 300 for UTC-5), so we report times in the creator's own clock. Returns
 * null until there are enough samples to be more than noise.
 */
export async function bestPostingTimes(userId: string, tzOffsetMinutes = 0, minSamples = 6): Promise<BestTimes | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('reach_samples')
    .select('posted_at,lift')
    .eq('user_id', userId)
    .eq('status', 'collected')
    .not('lift', 'is', null)
    .not('posted_at', 'is', null)
    .order('posted_at', { ascending: false })
    .limit(500)
  const rows = (data ?? []) as TimedRow[]

  const wk = new Map<number, number[]>()
  const hr = new Map<number, number[]>()
  const combo = new Map<string, number[]>()
  let n = 0
  for (const r of rows) {
    if (r.lift == null || !Number.isFinite(r.lift) || !r.posted_at) continue
    const t = Date.parse(r.posted_at)
    if (!Number.isFinite(t)) continue
    // Shift UTC → the creator's local clock, then read fields via UTC getters.
    const local = new Date(t - tzOffsetMinutes * 60000)
    const weekday = local.getUTCDay()
    const hour = local.getUTCHours()
    ;(wk.get(weekday) || wk.set(weekday, []).get(weekday))!.push(r.lift)
    ;(hr.get(hour) || hr.set(hour, []).get(hour))!.push(r.lift)
    const ck = `${weekday}:${hour}`
    ;(combo.get(ck) || combo.set(ck, []).get(ck))!.push(r.lift)
    n++
  }
  if (n < minSamples) return null

  const byWeekday: TimeBucket[] = []
  for (let d = 0; d < 7; d++) {
    const lifts = wk.get(d) || []
    byWeekday.push({ key: d, avgLift: lifts.length ? mean(lifts) : 0, samples: lifts.length })
  }
  const pickBest = (m: Map<number, number[]>): TimeBucket | null => {
    let best: TimeBucket | null = null
    for (const [key, lifts] of m) {
      if (lifts.length < 2) continue
      const avgLift = mean(lifts)
      if (!best || avgLift > best.avgLift) best = { key, avgLift, samples: lifts.length }
    }
    return best
  }
  const topWindows = [...combo.entries()]
    .filter(([, lifts]) => lifts.length >= 2)
    .map(([k, lifts]) => { const [weekday, hour] = k.split(':').map(Number); return { weekday, hour, avgLift: mean(lifts), samples: lifts.length } })
    .sort((a, b) => b.avgLift - a.avgLift)
    .slice(0, 3)

  return { samples: n, bestWeekday: pickBest(wk), bestHour: pickBest(hr), topWindows, byWeekday }
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
