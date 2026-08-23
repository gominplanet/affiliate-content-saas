/**
 * POST /api/deal-radar/bulk-schedule — queue MANY deals at once, spaced apart.
 *
 * The single-deal flow (social-post) schedules one deal at a time. This takes a
 * set of selected deals plus a start time and an interval, and queues them
 * staggered: deal i fires at firstAt + i × intervalMins. Same rows, same cron
 * (process-deal-schedules), same "skip if the deal has ended" safety as the
 * single path — the captions are written at fire time, so nothing is generated
 * up front.
 *
 * Staggering matters: a stack of near-identical posts hitting one account inside
 * the same minute is how a social account gets flagged as spam, so we space them
 * and keep the per-day cap.
 *
 * Body: {
 *   deals: [{ asin, title?, imageUrl? }],   // 1..MAX_BATCH
 *   platforms: string[],                     // link-friendly socials
 *   story?: boolean,
 *   firstAt: ISO,                            // when the first deal fires
 *   intervalMins: number,                    // minutes between each
 * }
 * Returns: { ok, scheduled, firstAt, lastAt } or an error.
 *
 * Gate: paid tiers (canUseDealRadar).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 60

// Same guardrail as the single-deal path: at most this many deal posts queued to
// fire on any one calendar day (UTC), per user. Protects the user's accounts
// from looking like a spam bot more than it protects us.
const DAILY_SCHEDULE_CAP = 50
// A single bulk action can queue at most this many deals. Keeps one click from
// filling a whole day in one go, and bounds the insert.
const MAX_BATCH = 30
// Allowed spacings (minutes). Mirrors the modal's options so a hand-crafted
// request can't queue everything into the same second.
const ALLOWED_INTERVALS = new Set([5, 15, 30, 60, 180, 360, 720, 1440])

interface DealInput { asin?: string; title?: string; imageUrl?: string }

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,amazon_associates_tag')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Amazon Deal Radar is available on paid plans.', currentTier: tier }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      deals?: unknown; platforms?: unknown; story?: boolean; firstAt?: string; intervalMins?: number
    }

    // ── Validate the deal set ────────────────────────────────────────────────
    const rawDeals = Array.isArray(body.deals) ? (body.deals as DealInput[]) : []
    const deals = rawDeals
      .map((d) => ({ asin: (d?.asin || '').trim().toUpperCase(), title: (d?.title || '').trim(), imageUrl: d?.imageUrl || null }))
      .filter((d) => /^[A-Z0-9]{10}$/.test(d.asin))
    // De-dupe by ASIN so the same deal isn't queued twice in one batch.
    const seen = new Set<string>()
    const uniqueDeals = deals.filter((d) => (seen.has(d.asin) ? false : (seen.add(d.asin), true)))
    if (uniqueDeals.length === 0) return NextResponse.json({ error: 'Select at least one deal to schedule.' }, { status: 400 })
    if (uniqueDeals.length > MAX_BATCH) {
      return NextResponse.json({ error: `You can schedule up to ${MAX_BATCH} deals at once. Trim your selection and try again.` }, { status: 400 })
    }

    // ── Validate platforms + timing ──────────────────────────────────────────
    const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
      .map((p) => String(p)).filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    const wantStory = body.story === true
    if (!platforms.length && !wantStory) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })

    const firstMs = new Date(body.firstAt || '').getTime()
    if (isNaN(firstMs)) return NextResponse.json({ error: 'That start time isn’t valid.' }, { status: 400 })
    if (firstMs < Date.now() - 60_000) return NextResponse.json({ error: 'Pick a start time in the future.' }, { status: 400 })

    const intervalMins = Number(body.intervalMins)
    if (!ALLOWED_INTERVALS.has(intervalMins)) return NextResponse.json({ error: 'Pick a valid interval between posts.' }, { status: 400 })

    // A tag is required to schedule link posts — fail fast rather than fire posts
    // that can never earn.
    if (platforms.length && !((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()) {
      return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
    }

    // ── Build the staggered rows ─────────────────────────────────────────────
    const rows = uniqueDeals.map((d, i) => ({
      user_id: user.id,
      asin: d.asin,
      title: d.title || null,
      image_url: d.imageUrl || null,
      platforms,
      story: wantStory,
      caption: null as string | null, // written at fire time
      scheduled_at: new Date(firstMs + i * intervalMins * 60_000).toISOString(),
      status: 'pending' as const,
    }))

    // ── Per-day cap: existing queued + this batch must fit under the cap on
    // every UTC day the batch touches. ISO strings are UTC (…Z), so the first
    // 10 chars are the UTC date key.
    const newByDay = new Map<string, number>()
    for (const r of rows) newByDay.set(r.scheduled_at.slice(0, 10), (newByDay.get(r.scheduled_at.slice(0, 10)) ?? 0) + 1)
    for (const [day, newCount] of newByDay) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any).from('deal_scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['pending', 'processing'])
        .gte('scheduled_at', `${day}T00:00:00.000Z`)
        .lte('scheduled_at', `${day}T23:59:59.999Z`)
      const existing = typeof count === 'number' ? count : 0
      if (existing + newCount > DAILY_SCHEDULE_CAP) {
        return NextResponse.json({
          error: `That would put ${existing + newCount} posts on ${day} (limit ${DAILY_SCHEDULE_CAP}/day). Widen the interval so they spill into the next day, or schedule fewer at once. This cap keeps your accounts from being flagged as spam.`,
        }, { status: 429 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase as any).from('deal_scheduled_posts').insert(rows)
    if (insErr) {
      console.error('[deal-radar/bulk-schedule]', insErr.message)
      return NextResponse.json({ error: toUserMessage(insErr, 'Could not schedule those posts. Please try again.') }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      scheduled: rows.length,
      firstAt: rows[0].scheduled_at,
      lastAt: rows[rows.length - 1].scheduled_at,
    })
  } catch (err) {
    console.error('[deal-radar/bulk-schedule]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't schedule those posts just now. Please try again in a moment.") }, { status: 500 })
  }
}
