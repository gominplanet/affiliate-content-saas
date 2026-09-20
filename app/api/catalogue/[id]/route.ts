// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/catalogue/[id] — a run's state, as one card per video with a verdict
// per marketplace, plus counts that came from a count.
//
// NO NUMBER HERE IS A PAGE LENGTH. An earlier version fetched the run's items
// and counted the array, and a real run then reported "472 of 583" for a
// catalogue of over a thousand: PostgREST caps a response at 1000 rows, and a
// 1000-video run across five markets is several thousand. The counts now come
// from catalogue_run_summary (migration 349), which aggregates in Postgres, and
// the only rows fetched are the bounded set needed to draw the cards.
//
// PER VIDEO, because the answer is per video. A creator wants to see "this one
// can go to Germany free and to France for a dub", which is a row about a video
// rather than a bucket it fell into.
//
// THREE VERDICTS PER MARKET, not two:
//   eligible  YouTube already dubbed it, so the track is pulled and it is free
//   paid      no track, so MVP dubs it, the same lane Launchpad has always used
//   skipped   it genuinely cannot go: the run's market is unusable
// and one verdict about the VIDEO (no product attached, not on YouTube), stored
// once on a row with no domain because it is true of every market.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { marketByDomain } from '@/lib/markets'
import { decodeHtmlEntities } from '@/lib/decode-entities'

export const runtime = 'nodejs'

type Bucket = { domain: string; state: string; reason: string | null; n: number }
type Summary = {
  videos: number; videosPending: number
  buckets: Bucket[]; cardVideoIds: string[]
}
type Row = { id: string; state: string; reason: string | null; video_id: string; domain: string | null }

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: run } = await sb.from('catalogue_runs')
    .select('id,domain,domains,state,detail,created_at')
    .eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  const { data: raw, error: sumErr } = await sb.rpc('catalogue_run_summary', { p_run: id })
  if (sumErr || !raw) {
    // SAID, not swallowed. Without the summary every number on the screen would
    // be a guess, and a screen that quietly shows zeros is worse than one that
    // says the count could not be read.
    return NextResponse.json({
      error: 'Could not read this run\'s counts. Run migration 349, then reload.',
      detail: sumErr?.message ?? null,
    }, { status: 500 })
  }
  const summary = raw as Summary
  const buckets: Bucket[] = Array.isArray(summary.buckets) ? summary.buckets : []
  const cardIds: string[] = Array.isArray(summary.cardVideoIds) ? summary.cardVideoIds : []

  const domainList: string[] = Array.isArray(run.domains) && run.domains.length > 0
    ? run.domains
    : (run.domain ? [run.domain] : [])

  const sum = (f: (b: Bucket) => boolean) => buckets.filter(f).reduce((n, b) => n + Number(b.n || 0), 0)
  const reasonsFor = (f: (b: Bucket) => boolean) => buckets.filter(f)
    .map((b) => ({ reason: b.reason || 'no reason recorded', count: Number(b.n || 0) }))
    .sort((a, b) => b.count - a.count)

  // Market-independent verdicts, listed once. "no product attached" is the
  // creator's to fix and "not on YouTube" is not, so they stay separate lines.
  const blockedReasons = reasonsFor((b) => !b.domain)

  const markets = domainList.map((domain) => {
    const mine = (s: string) => sum((b) => b.domain === domain && b.state === s)
    const m = marketByDomain(domain)
    return {
      domain,
      country: m?.country ?? domain,
      langName: m?.langName ?? null,
      pending: mine('pending'), free: mine('eligible'), paid: mine('paid'),
      skipped: mine('skipped'), queued: mine('queued'),
      delivered: mine('delivered'), failed: mine('failed'),
      failedReasons: reasonsFor((b) => b.domain === domain && b.state === 'failed'),
    }
  })

  // ── the cards ─────────────────────────────────────────────────────────────
  // Bounded by the ids the summary already picked, so this fetch is at most
  // 250 videos times the run's markets and can never hit the row cap.
  let cards: Array<{
    videoId: string; title: string; thumbnail: string | null
    markets: Array<{ domain: string; country: string; langName: string | null; itemId: string | null; state: string; reason: string | null }>
  }> = []

  if (cardIds.length > 0) {
    const [{ data: items }, { data: vids }] = await Promise.all([
      sb.from('catalogue_run_items')
        .select('id,state,reason,video_id,domain')
        .eq('run_id', id).eq('user_id', user.id).in('video_id', cardIds),
      sb.from('youtube_videos')
        .select('id,title,thumbnail_url').eq('user_id', user.id).in('id', cardIds),
    ])

    const byVideo = new Map<string, Map<string, Row>>()
    for (const r of ((items ?? []) as Row[])) {
      if (!r.domain) continue
      const m = byVideo.get(r.video_id) ?? new Map<string, Row>()
      m.set(r.domain, r); byVideo.set(r.video_id, m)
    }
    const meta = new Map<string, { title: string; thumb: string | null }>()
    for (const v of (vids ?? [])) {
      // Titles are stored as they came off YouTube, which means "I&#39;ve".
      // Rendering that raw puts the entity on the card.
      meta.set(v.id, { title: decodeHtmlEntities(v.title || '') || '(untitled)', thumb: v.thumbnail_url ?? null })
    }

    cards = cardIds.filter((vid) => byVideo.has(vid)).map((vid) => ({
      videoId: vid,
      title: meta.get(vid)?.title ?? '(untitled)',
      thumbnail: meta.get(vid)?.thumb ?? null,
      markets: domainList.map((domain) => {
        const item = byVideo.get(vid)?.get(domain)
        const m = marketByDomain(domain)
        return {
          domain,
          country: m?.country ?? domain,
          langName: m?.langName ?? null,
          itemId: item?.id ?? null,
          // A market with no row yet has not been looked at. That reads as
          // "checking", never as "no track".
          state: item?.state ?? 'pending',
          reason: item?.reason ?? null,
        }
      }),
    }))
  }

  const actionable = sum((b) => !!b.domain && ['eligible', 'paid', 'queued', 'delivered', 'failed'].includes(b.state))

  return NextResponse.json({
    ok: true,
    run: { id: run.id, domains: domainList, state: run.state, createdAt: run.created_at },
    videos: {
      total: Number(summary.videos || 0),
      checked: Number(summary.videos || 0) - Number(summary.videosPending || 0),
      pending: Number(summary.videosPending || 0),
      blocked: sum((b) => !b.domain),
      // Videos with at least one sendable store, and how many of them are drawn.
      actionable: cardIds.length,
      shown: cards.length,
      moreThanShown: actionable > 0 && cardIds.length >= 250,
    },
    blockedReasons,
    markets,
    cards,
    totals: {
      free: sum((b) => b.state === 'eligible'),
      paid: sum((b) => b.state === 'paid'),
      queued: sum((b) => b.state === 'queued'),
      delivered: sum((b) => b.state === 'delivered'),
      failed: sum((b) => b.state === 'failed'),
    },
  })
}

// DELETE /api/catalogue/[id] — abandon a run.
//
// The screen needs this because clearing its own state is not the same as
// closing the run. A creator who changed their marketplace selection, pressed
// Find and got "picking up the run already in progress" was handed back the
// OLD run, with the old markets, while the ticks showed their new choice. The
// only honest exits are to keep that run or to end it.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Marked abandoned rather than deleted: the items cascade, and a run that
  // already queued work into the storefront pipeline is a record of what was
  // sent. `abandoned` is simply not one of the states start/ will resume.
  const { error } = await sb.from('catalogue_runs')
    .update({ state: 'abandoned', updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: 'Could not close that run.' }, { status: 500 })

  // Its unscanned items are dropped so the cron stops spending lookups on a run
  // nobody is watching. Anything already resolved or queued stays.
  await sb.from('catalogue_run_items')
    .delete().eq('run_id', id).eq('user_id', user.id).eq('state', 'pending')

  return NextResponse.json({ ok: true })
}
