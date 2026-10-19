/**
 * /api/deals/hub-socials: social posts from the member's own Deals Hub file.
 *
 * Seb, 2026-10-19: "I don't think people want to write a hundred blog posts
 * based on these deals ... we should really focus on social media pushes from
 * there. So Pinterest, Facebook, Instagram, you know the drill."
 *
 * POST queues each picked deal (components/deals/DealsHubImport) as a
 * deal_scheduled_posts row, the same queue Deal Radar's scheduling uses, so
 * the same cron (process-deal-schedules) and the same publish path send it.
 * Each fires when its deal starts on Amazon, never before, spaced apart so a
 * stack of deals starting at the same minute does not land as one burst. The
 * row keeps the deal as the file gave it (migration 445, deal_known): Deal
 * Radar never carried it, so the file's own window says whether it is live
 * when it fires, and an ended deal is skipped and said.
 *
 *   POST   { deals: [{ asin, title, brand?, imageUrl?, discountPct?, belowYtd?, startsAt, endsAt? }],
 *            platforms: string[], story?: boolean, intervalMins }
 *          → { ok, scheduled: [{ asin, at }], skipped: [{ asin, reason }] }
 *   GET    → { posts: [...] } this member's Deals Hub social posts, newest first
 *   DELETE ?id= → cancels one that has not gone out
 *
 * Labs (deals_import) while it is tested, on top of the Deal Radar plan gate.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { canUseDealRadar } from '@/lib/feature-access'
import { canUsePreview } from '@/lib/labs-preview'
import { QUICK_POST_PLATFORMS, type QuickPostPlatform } from '@/lib/deal-social-publish'
import { toUserMessage } from '@/lib/friendly-error'
import { hubSchedule, HUB_INTERVALS, HUB_MAX_BATCH, type HubSocialDeal } from '@/lib/deals-hub-socials'
import type { KnownDeal } from '@/lib/deal-quick-post'

export const runtime = 'nodejs'
export const maxDuration = 60

// The same guardrail as Deal Radar's scheduling: at most this many deal posts
// on one UTC day per member, so their accounts do not read as a spam bot.
const DAILY_SCHEDULE_CAP = 50

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function member(): Promise<{ supabase: any; userId: string; tier: Tier; tag: string } | NextResponse> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier,amazon_associates_tag').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier) as Tier
  if (!canUseDealRadar(tier) || !canUsePreview('deals_import', tier)) {
    return NextResponse.json({ error: 'Deals Hub social posts are not open on this account yet.', currentTier: tier }, { status: 403 })
  }
  return { supabase, userId: user.id, tier, tag: ((intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag || '').trim() }
}

export async function POST(request: Request) {
  try {
    const m = await member()
    if (m instanceof NextResponse) return m
    const body = await request.json().catch(() => ({})) as { deals?: unknown; platforms?: unknown; story?: boolean; intervalMins?: number }

    const rawPlatforms = (Array.isArray(body.platforms) ? body.platforms : []).map((p) => String(p))
    const textPlatforms = rawPlatforms.filter((p): p is QuickPostPlatform => QUICK_POST_PLATFORMS.includes(p as QuickPostPlatform))
    const wantPinterest = rawPlatforms.includes('pinterest')
    const wantInstagram = rawPlatforms.includes('instagram')
    const wantStory = body.story === true
    if (!textPlatforms.length && !wantPinterest && !wantInstagram && !wantStory) return NextResponse.json({ error: 'Pick at least one network.' }, { status: 400 })
    if ((textPlatforms.length || wantPinterest) && !m.tag) {
      return NextResponse.json({ error: 'Add your Amazon Associates tag in Settings first, so your links earn.' }, { status: 400 })
    }
    const intervalMins = Number(body.intervalMins)
    if (!HUB_INTERVALS.includes(intervalMins)) return NextResponse.json({ error: 'Pick how far apart the posts go.' }, { status: 400 })

    const deals = (Array.isArray(body.deals) ? body.deals : []) as HubSocialDeal[]
    if (!deals.length) return NextResponse.json({ error: 'Pick at least one deal.' }, { status: 400 })
    if (deals.length > HUB_MAX_BATCH) return NextResponse.json({ error: `Up to ${HUB_MAX_BATCH} deals at a time.` }, { status: 400 })

    const plan = hubSchedule(deals, intervalMins)
    if (!plan.scheduled.length) return NextResponse.json({ ok: true, scheduled: [], skipped: plan.skipped })

    const stored = [...textPlatforms, ...(wantPinterest ? ['pinterest'] : []), ...(wantInstagram ? ['instagram'] : [])]
    const rows = plan.scheduled.map((s) => ({
      user_id: m.userId,
      asin: s.deal.asin,
      title: s.deal.title || null,
      image_url: s.deal.imageUrl || null,
      platforms: stored,
      story: wantStory,
      caption: null as string | null, // written when it fires
      scheduled_at: s.at,
      status: 'pending' as const,
      deal_known: {
        source: 'deals_hub', title: s.deal.title, brand: s.deal.brand ?? null, imageUrl: s.deal.imageUrl ?? null,
        discountPct: s.deal.discountPct ?? null, belowYtd: !!s.deal.belowYtd, startsAt: s.deal.startsAt, endsAt: s.deal.endsAt ?? null,
      } satisfies KnownDeal,
    }))

    const byDay = new Map<string, number>()
    for (const r of rows) byDay.set(r.scheduled_at.slice(0, 10), (byDay.get(r.scheduled_at.slice(0, 10)) ?? 0) + 1)
    for (const [day, n] of byDay) {
      const { count } = await m.supabase.from('deal_scheduled_posts').select('id', { count: 'exact', head: true })
        .eq('user_id', m.userId).in('status', ['pending', 'processing'])
        .gte('scheduled_at', `${day}T00:00:00.000Z`).lte('scheduled_at', `${day}T23:59:59.999Z`)
      const existing = typeof count === 'number' ? count : 0
      if (existing + n > DAILY_SCHEDULE_CAP) {
        return NextResponse.json({
          error: `That would put ${existing + n} deal posts on ${day}, over the ${DAILY_SCHEDULE_CAP} a day that keeps your accounts from being flagged as spam. Space them further apart or pick fewer.`,
        }, { status: 429 })
      }
    }

    const { error } = await m.supabase.from('deal_scheduled_posts').insert(rows)
    if (error) {
      if (/deal_known/.test(error.message || '')) {
        return NextResponse.json({ error: 'Nothing was scheduled: the database needs migration 445 (deal_known) first.', code: 'migration_445' }, { status: 503 })
      }
      console.error('[deals/hub-socials]', error.message)
      return NextResponse.json({ error: toUserMessage(error, 'Could not schedule those posts. Please try again.') }, { status: 500 })
    }
    return NextResponse.json({ ok: true, scheduled: plan.scheduled.map((s) => ({ asin: s.deal.asin, at: s.at })), skipped: plan.skipped })
  } catch (err) {
    console.error('[deals/hub-socials]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Could not schedule those posts just now. Please try again in a moment.') }, { status: 500 })
  }
}

export async function GET() {
  const m = await member()
  if (m instanceof NextResponse) return m
  const { data, error } = await m.supabase.from('deal_scheduled_posts')
    .select('id,asin,title,platforms,story,scheduled_at,status,error_message,results')
    .eq('user_id', m.userId).not('deal_known', 'is', null)
    .order('scheduled_at', { ascending: false }).limit(100)
  if (error) {
    if (/deal_known/.test(error.message || '')) return NextResponse.json({ posts: [], note: 'The database needs migration 445 (deal_known).' })
    return NextResponse.json({ error: 'Could not read your scheduled deal posts.' }, { status: 500 })
  }
  return NextResponse.json({ posts: data ?? [] })
}

export async function DELETE(request: Request) {
  const m = await member()
  if (m instanceof NextResponse) return m
  const id = new URL(request.url).searchParams.get('id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Which post?' }, { status: 400 })
  // Only one that has not gone out: a claimed row is being sent right now.
  const { data, error } = await m.supabase.from('deal_scheduled_posts')
    .update({ status: 'skipped', error_message: 'Cancelled by you.', updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', m.userId).eq('status', 'pending').select('id')
  if (error) return NextResponse.json({ error: 'Could not cancel it.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'It is already being sent or has gone out, so it could not be cancelled.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
