/**
 * POST /api/deal-radar/social-post — Deal Radar "Quick post".
 *
 * Publish ONE deal straight to the link-friendly socials (X, Facebook, Threads,
 * LinkedIn, Telegram, Bluesky) with a thumbnail, a price-safe caption, and the
 * creator's own affiliate link. Skips the blog for time-sensitive deals. NOT
 * Instagram/TikTok (no clickable caption link) or Pinterest (pins go to blog).
 *
 * Body: { asin, platforms: string[], caption?, story?, title?, imageUrl?, scheduledFor? }
 *   - scheduledFor (ISO time, future): queue the post instead of firing now. The
 *     process-deal-schedules cron publishes it at that time and SKIPS it if the
 *     deal has ended by then (you never promote a dead deal).
 * Returns: { ok, results } for an immediate post, or { ok, scheduled, scheduledFor }.
 *
 * Gate: Pro (+ admin), Labs while testing (NEXT_PUBLIC_DEAL_RADAR_ENABLED).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { executeDealQuickPost } from '@/lib/deal-quick-post'
import { toUserMessage } from '@/lib/friendly-error'
import { spendGate } from '@/lib/ai-spend'

export const runtime = 'nodejs'
export const maxDuration = 120

// A soft guardrail on scheduling: at most this many deal posts queued to fire on
// any one calendar day (UTC), per user. This protects the user more than us —
// firing dozens of near-identical posts a day is how a social account gets
// flagged as spam by the platforms. The cost to MVP is negligible either way.
const DAILY_SCHEDULE_CAP = 50

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: intRow } = await supabase
      .from('integrations')
      .select('tier,amazon_associates_tag,geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (!canUseDealRadar(tier)) {
      return NextResponse.json({ error: 'Amazon Deal Radar is available on paid plans.', currentTier: tier }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as { asin?: string; platforms?: unknown; caption?: string; title?: string; imageUrl?: string; story?: boolean; scheduledFor?: string }
    const asin = (body.asin || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })
    const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
      .map((p) => String(p)).filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    // Instagram Story is a separate path (image + baked "link in bio" CTA — a
    // Story published via the API can't carry a caption or a tappable link).
    const wantStory = body.story === true
    if (!platforms.length && !wantStory) return NextResponse.json({ error: 'Pick at least one platform.' }, { status: 400 })

    // ── Schedule for later ──────────────────────────────────────────────────
    // A future scheduledFor means: don't post now, queue it. The
    // process-deal-schedules cron fires it at that time and, crucially, skips it
    // if the deal has ended by then (lib/deal-quick-post requireLiveDeal).
    if (body.scheduledFor) {
      const when = new Date(body.scheduledFor)
      if (isNaN(when.getTime())) return NextResponse.json({ error: 'That schedule time isn’t valid.' }, { status: 400 })
      // Reject clearly-past times (allow a minute of clock skew).
      if (when.getTime() < Date.now() - 60_000) return NextResponse.json({ error: 'Pick a time in the future.' }, { status: 400 })
      // A tag is required to schedule too — fail fast rather than surprise them
      // when the post fires with nothing to earn.
      if (platforms.length && !((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim()) {
        return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
      }
      // Daily cap: count what's already queued for that calendar day (UTC) and
      // refuse once it hits DAILY_SCHEDULE_CAP. Best-effort — a count error never
      // blocks a legitimate schedule.
      const dayStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate(), 0, 0, 0))
      const dayEnd = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate(), 23, 59, 59, 999))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: dayCount } = await (supabase as any).from('deal_scheduled_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .in('status', ['pending', 'processing'])
        .gte('scheduled_at', dayStart.toISOString())
        .lte('scheduled_at', dayEnd.toISOString())
      if (typeof dayCount === 'number' && dayCount >= DAILY_SCHEDULE_CAP) {
        return NextResponse.json({
          error: `You already have ${dayCount} posts scheduled for that day (limit ${DAILY_SCHEDULE_CAP}). Spread them across other days, or post some now. This cap keeps your accounts from being flagged as spam.`,
        }, { status: 429 })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insErr } = await (supabase as any).from('deal_scheduled_posts').insert({
        user_id: user.id,
        asin,
        title: (body.title || '').trim() || null,
        image_url: body.imageUrl || null,
        platforms,
        story: wantStory,
        caption: (body.caption || '').trim() || null,
        scheduled_at: when.toISOString(),
        status: 'pending',
      })
      if (insErr) {
        console.error('[deal-radar/social-post schedule]', insErr.message)
        return NextResponse.json({ error: toUserMessage(insErr, 'Could not schedule that post. Please try again.') }, { status: 500 })
      }
      return NextResponse.json({ ok: true, scheduled: true, scheduledFor: when.toISOString() })
    }

    // ── Post now ────────────────────────────────────────────────────────────
    const gate = await spendGate(user.id, tier)
    if (gate) return gate

    const out = await executeDealQuickPost({
      db: supabase, userId: user.id, tier, intRow: intRow ?? null,
      asin, platforms, story: wantStory,
      caption: body.caption, title: body.title, imageUrl: body.imageUrl,
    })
    if (out.missingTag) return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
    if (out.dealEnded && out.results.length === 0) return NextResponse.json({ error: 'That deal is no longer on the radar.' }, { status: 404 })
    const anyOk = out.results.some((r) => r.ok)
    return NextResponse.json({ ok: anyOk, results: out.results, caption: out.caption, geniuslinkNote: out.geniuslinkNote }, { status: anyOk ? 200 : 502 })
  } catch (err) {
    console.error('[deal-radar/social-post]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, "Couldn't post just now. Please try again in a moment.") }, { status: 500 })
  }
}
