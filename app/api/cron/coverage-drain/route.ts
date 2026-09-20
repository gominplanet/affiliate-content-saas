// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/coverage-drain — keep the coverage grid moving, forever.
//
// THIS REPLACES THE RUN. Nobody starts it, nobody resumes it, there is nothing
// to abandon. A creator ticks the countries they want and this works through
// their catalogue from the most valuable thing not yet done, whether or not any
// page is open. A new video joins the grid the next time this fires.
//
// FOUR STEPS, and each firing does a little of each so nothing starves:
//
//   1. ENROL   every video the creator has, for every market they ticked, gets
//              a row. Once. This is what makes the grid standing rather than a
//              scan somebody has to remember to run.
//   2. PRODUCT the ASIN, from the columns if it is there and by following the
//              description's link if it is not. Cached on the video.
//   3. STOCK   is the product actually sold in that country at all, and is
//              anything buyable. FIRST, before a single second of audio is
//              rendered.
//   4. CHECK   does the video already carry that language (YouTube's track
//              list), which decides whose voice ships.
//   5. PREPARE hand it to the existing storefront pipeline, which translates,
//              dubs and builds the thumbnail. The cell becomes 'ready'.
//
// STOCK COMES BEFORE THE DUB, and that ordering is the expensive half of this
// file. The steps used to run product → track → pipeline, so a product Amazon
// Japan has never sold still got translated, dubbed and given a thumbnail, and
// the creator learned it could not go at the upload. Now a cell cannot reach
// the track check until the existence question has an answer.
//
// RECENCY AND STOCK decide the order, which is what the creator asked for and
// also the only pair that costs nothing to know. Both change on their own, so
// the queue re-sorts itself with nobody maintaining a list.
//
// A LOOKUP THAT FAILED IS NEVER A VERDICT. Every step leaves the cell where it
// was and retries next time rather than recording "cannot go" because a service
// was down. Telling a creator their video cannot reach Germany when nobody
// managed to look is the worst thing this can do.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { marketByDomain } from '@/lib/markets'
import { asinFromAmazonUrl } from '@/lib/asin'
import { resolveAsinFromLinks } from '@/lib/product-link'
import { ingestConfigured } from '@/lib/youtube-ingest'
import { audioLanguagesFor, carriesLanguage, AUDIO_COLUMNS } from '@/lib/audio-tracks'
import { coveragePriority, stockBlocks, type StockAnswer } from '@/lib/storefront-coverage'
import { fetchKeepaBasics, fetchKeepaTokenStatus, keepaConfigured } from '@/services/keepa'
import { dubTarget } from '@/lib/dub-target'
import { normalizeTier } from '@/lib/tier'
import { STALL_AFTER_MS } from '@/lib/global-sync-recovery'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Videos enrolled per firing. The grid fills over hours rather than in one
 *  request that would run past the function budget on a large channel. */
const ENROL = 400
/** Product links followed. Each is up to five redirect hops. */
const PRODUCTS = 8
/** Track-list lookups. Each is one yt-dlp call through the residential proxy,
 *  and YouTube's bot wall does not tolerate these arriving in bulk. */
const CHECKS = 10

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** Every (video, ticked market) pair that has no row yet. */
async function enrol(sb: Sb): Promise<number> {
  const { data: mkts } = await sb.from('storefront_markets')
    .select('user_id,domain').eq('enabled', true)
  const byUser = new Map<string, string[]>()
  for (const m of (mkts ?? [])) {
    byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.domain])
  }
  if (byUser.size === 0) return 0

  let made = 0
  for (const [userId, domains] of byUser) {
    // Newest first, because that is also the drain order and it puts the most
    // valuable rows in the grid first on a catalogue too big for one pass.
    const { data: vids } = await sb.from('youtube_videos')
      .select('id,published_at,created_at').eq('user_id', userId)
      .order('published_at', { ascending: false, nullsFirst: false }).limit(ENROL)
    const videos = vids ?? []
    if (videos.length === 0) continue

    const { data: have } = await sb.from('storefront_coverage')
      .select('video_id,domain').eq('user_id', userId)
      .in('video_id', videos.map((v: { id: string }) => v.id))
    const seen = new Set((have ?? []).map((h: { video_id: string; domain: string }) => `${h.video_id}:${h.domain}`))

    const rows: Array<Record<string, unknown>> = []
    for (const v of videos) {
      for (const domain of domains) {
        if (seen.has(`${v.id}:${domain}`)) continue
        rows.push({
          user_id: userId, video_id: v.id, domain, state: 'unknown',
          // Stock is not known yet, so this is the recency term alone. The
          // check step adds the stock bonus once it has an answer.
          priority: coveragePriority({ publishedAt: v.published_at ?? v.created_at }),
        })
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      // Conflicts are expected: two firings can overlap on the same catalogue.
      await sb.from('storefront_coverage')
        .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true })
    }
    made += rows.length
  }
  return made
}

/** The ASIN, for videos whose cells have none. */
async function products(sb: Sb): Promise<{ found: number; blocked: number }> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('video_id,user_id').eq('state', 'unknown').is('asin', null)
    .order('priority', { ascending: false }).limit(PRODUCTS * 6)

  // One lookup per VIDEO, not per cell: the answer is the same in every market.
  const byVideo = new Map<string, string>()
  for (const c of (cells ?? [])) {
    if (byVideo.size >= PRODUCTS && !byVideo.has(c.video_id)) continue
    byVideo.set(c.video_id, c.user_id)
  }
  if (byVideo.size === 0) return { found: 0, blocked: 0 }

  const { data: vids } = await sb.from('youtube_videos')
    .select('id,asin,product_url,description').in('id', [...byVideo.keys()])
  let found = 0
  let blocked = 0
  const now = new Date().toISOString()

  for (const v of (vids ?? [])) {
    const text = `${v.product_url ?? ''}\n${v.description ?? ''}`
    let asin: string | null = (v.asin as string | null)?.trim()
      || asinFromAmazonUrl(String(v.product_url ?? ''))
      || asinFromAmazonUrl(String(v.description ?? ''))
      || null

    if (!asin) {
      try {
        // FOLLOWS ANY PRODUCT LINK, whatever the host. A hardcoded list of
        // shorteners reported a creator on a branded Geniuslink domain as
        // having no product on a single video in their catalogue.
        const hit = await resolveAsinFromLinks(text, null, 3)
        asin = hit?.asin ?? null
      } catch {
        // Could not look. Left alone so the next firing retries it.
        continue
      }
    }

    if (!asin) {
      await sb.from('storefront_coverage').update({
        state: 'blocked',
        reason: 'no Amazon product link in this video’s description',
        checked_at: now, updated_at: now,
      }).eq('video_id', v.id).eq('state', 'unknown')
      blocked++
      continue
    }

    // Cached on the video, which is what migration 204 added the column for:
    // the redirect is followed once and every ASIN-keyed feature reads it free.
    await sb.from('youtube_videos').update({ asin }).eq('id', v.id)
    await sb.from('storefront_coverage')
      .update({ asin, updated_at: now }).eq('video_id', v.id).is('asin', null)
    found++
  }
  return { found, blocked }
}

// ── the existence pass ──────────────────────────────────────────────────────
/** Cells looked at per firing. Most are answered from the shared cache, which
 *  costs nothing, so this is far larger than the lookup budget below. */
const STOCK_CELLS = 240
/** Keepa lookups actually PAID FOR per firing. This cron fires every minute and
 *  Keepa's tokens refill a handful a minute, so a generous number here would
 *  drain the pool the whole product shares within an hour. */
const STOCK_LOOKUPS = 20
/** How long a cached answer stands. Whether a product is sold in a country at
 *  all barely changes; whether it is buyable today changes weekly. Two weeks is
 *  the compromise, and a wrong "out of stock" only costs ordering, never a
 *  block. */
const STOCK_CACHE_DAYS = 14
/** Yield the shared pool to interactive use below this. Deal Radar and the
 *  Finder are somebody waiting on a screen; this is a background grid. */
const MIN_KEEPA_TOKENS = 200

/**
 * Is the product actually on sale in that country.
 *
 * THE FIRST PASS. Everything downstream costs real minutes: a translation, a
 * dub, a rendered thumbnail, an upload slot in the creator's own browser. None
 * of it can produce a listing for a product that country has never sold, so
 * this runs before any of it and blocks the cells that cannot go.
 *
 * NOT LISTED IS THE ONLY BLOCKING ANSWER. Out of stock is temporary and a video
 * prepared today is ready when stock returns. No answer at all keeps the cell
 * moving: Australia has no Keepa domain, and refusing to ever deliver there
 * would be a worse lie than delivering without the check.
 *
 * NO MAP ENTRY IS NOT A VERDICT. Keepa returns a product object with a null
 * title for an ASIN it has no listing for in that domain, so a null title is
 * the answer "not sold there". An ASIN missing from the response entirely means
 * the request failed, and that cell is left exactly as it was to be retried.
 *
 * The answer is shared across creators in passport_asin_market, which has held
 * this exact question since migration 294. Two creators promoting the same
 * product pay for one lookup between them.
 */
async function stock(sb: Sb): Promise<{ answered: number; blocked: number; spent: number; skipped?: string }> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,video_id,domain,asin').eq('state', 'unknown')
    .not('asin', 'is', null).is('stock', null)
    .order('priority', { ascending: false }).limit(STOCK_CELLS)
  const rows: Array<{ id: string; video_id: string; domain: string; asin: string }> = cells ?? []
  if (rows.length === 0) return { answered: 0, blocked: 0, spent: 0 }

  const now = new Date().toISOString()
  let answered = 0, blocked = 0, spent = 0

  // The answers, keyed by the pair they are about.
  const key = (asin: string, domain: string) => `${asin.toUpperCase()}:${domain}`
  const answers = new Map<string, StockAnswer>()

  // 1. Markets no server can answer. Free, and settled once rather than retried
  //    every minute forever.
  const serverless = rows.filter((r) => marketByDomain(r.domain)?.keepa == null)
  for (const r of serverless) answers.set(key(r.asin, r.domain), 'no_answer')

  const askable = rows.filter((r) => marketByDomain(r.domain)?.keepa != null)

  // 2. The shared cache, across every creator.
  const fresh = new Date(Date.now() - STOCK_CACHE_DAYS * 86_400_000).toISOString()
  const wantedAsins = [...new Set(askable.map((r) => r.asin.toUpperCase()))]
  if (wantedAsins.length > 0) {
    try {
      const { data: cached } = await sb.from('passport_asin_market')
        .select('asin,marketplace,available,in_stock')
        .in('asin', wantedAsins).gte('checked_at', fresh)
      for (const c of (cached ?? [])) {
        const mkt = [...new Set(askable.map((r) => r.domain))]
          .find((d) => marketByDomain(d)?.host.toLowerCase() === String(c.marketplace).toLowerCase())
        if (!mkt) continue
        // in_stock is NULL where the writer did not know the buy box (SCOUT's
        // /dp probe answers existence only), and that is recorded as listed
        // rather than invented as out of stock.
        const a: StockAnswer = !c.available ? 'not_listed' : (c.in_stock === false ? 'out_of_stock' : 'in_stock')
        answers.set(key(String(c.asin), mkt), a)
      }
    } catch { /* no cache → everything below is a miss, which is correct */ }
  }

  // 3. What is left is paid for, within budget, newest-first because the claim
  //    query already ordered by priority.
  const misses = askable.filter((r) => !answers.has(key(r.asin, r.domain)))
  if (misses.length > 0) {
    if (!keepaConfigured()) {
      // NOBODY LOOKED, and nobody can. Recorded only for the markets already
      // settled above; the rest stay NULL and retry when a key exists.
      await writeStock(sb, rows, answers, now)
      return { answered: answers.size, blocked: 0, spent: 0, skipped: 'keepa_unconfigured' }
    }
    const tok = await fetchKeepaTokenStatus()
    if (tok.tokensLeft != null && tok.tokensLeft < MIN_KEEPA_TOKENS) {
      await writeStock(sb, rows, answers, now)
      return { answered: answers.size, blocked: 0, spent: 0, skipped: 'low_tokens' }
    }

    // One call per domain, up to 100 ASINs each, so a catalogue sharing five
    // products across two hundred videos pays five lookups per country.
    const byDomain = new Map<string, Set<string>>()
    for (const r of misses) byDomain.set(r.domain, (byDomain.get(r.domain) ?? new Set()).add(r.asin.toUpperCase()))

    let budget = STOCK_LOOKUPS
    const writeBack: Array<Record<string, unknown>> = []
    for (const [domain, asinSet] of byDomain) {
      if (budget <= 0) break
      const mkt = marketByDomain(domain)
      if (!mkt || mkt.keepa == null) continue
      const batch = [...asinSet].slice(0, budget)
      let info: Awaited<ReturnType<typeof fetchKeepaBasics>>
      try {
        info = await fetchKeepaBasics(batch, mkt.keepa)
      } catch {
        // Left alone so the next firing retries it.
        continue
      }
      budget -= batch.length
      spent += batch.length
      for (const asin of batch) {
        const p = info.get(asin)
        // ABSENT FROM THE RESPONSE = the lookup did not happen for this ASIN.
        // Never a verdict, so the cell keeps its NULL and comes back around.
        if (!p) continue
        const listed = !!p.title
        const a: StockAnswer = !listed ? 'not_listed' : (p.priceNowCents != null ? 'in_stock' : 'out_of_stock')
        answers.set(key(asin, domain), a)
        writeBack.push({
          asin, marketplace: mkt.host.toLowerCase(), available: listed,
          in_stock: listed ? p.priceNowCents != null : false,
          price_cents: p.priceNowCents ?? null, checked_at: now,
        })
      }
    }
    if (writeBack.length > 0) {
      try {
        await sb.from('passport_asin_market').upsert(writeBack, { onConflict: 'asin,marketplace' })
      } catch { /* the cache is best-effort; the answers below still land */ }
    }
  }

  const written = await writeStock(sb, rows, answers, now)
  answered = written.answered
  blocked = written.blocked
  return { answered, blocked, spent }
}

/** Put the answers on the cells. Separate so every early return above still
 *  records what it did manage to settle, rather than throwing the free answers
 *  away because the paid ones could not be had. */
async function writeStock(
  sb: Sb,
  rows: Array<{ id: string; video_id: string; domain: string; asin: string }>,
  answers: Map<string, StockAnswer>,
  now: string,
): Promise<{ answered: number; blocked: number }> {
  const withAnswer = rows
    .map((r) => ({ ...r, answer: answers.get(`${r.asin.toUpperCase()}:${r.domain}`) }))
    .filter((r): r is typeof r & { answer: StockAnswer } => !!r.answer)
  if (withAnswer.length === 0) return { answered: 0, blocked: 0 }

  // Recency, which the priority also needs, and which one read covers.
  const { data: vids } = await sb.from('youtube_videos')
    .select('id,published_at,created_at').in('id', [...new Set(withAnswer.map((r) => r.video_id))])
  const pubBy = new Map<string, string | null>()
  for (const v of (vids ?? [])) pubBy.set(v.id, v.published_at ?? v.created_at ?? null)

  let blocked = 0
  // Grouped by the update they need, so a firing is a handful of statements
  // rather than two hundred and forty.
  //
  // THE DOMAIN IS PART OF THE KEY. Without it a group spans countries, and the
  // blocked reason then names every country in the group on a cell that is only
  // blocked in one of them. A reason that lists France to somebody whose Italian
  // cell is stuck is worse than no reason: it sends them to check the wrong
  // store.
  const groups = new Map<string, { answer: StockAnswer; domain: string; pri: number; ids: string[] }>()
  for (const r of withAnswer) {
    const pri = coveragePriority({ publishedAt: pubBy.get(r.video_id), inStock: r.answer === 'in_stock' })
    const k = `${r.answer}|${r.domain}|${pri}`
    const g = groups.get(k) ?? { answer: r.answer, domain: r.domain, pri, ids: [] }
    g.ids.push(r.id)
    groups.set(k, g)
  }
  for (const g of groups.values()) {
    const blocking = stockBlocks(g.answer)
    if (blocking) blocked += g.ids.length
    const country = marketByDomain(g.domain)?.country ?? g.domain
    for (let i = 0; i < g.ids.length; i += 200) {
      await sb.from('storefront_coverage').update({
        stock: g.answer, stock_at: now, priority: g.pri, updated_at: now,
        // BLOCKED IN THE CREATOR'S WORDS, naming the one country it is about,
        // because the next thing they will want to know is whether it is
        // fixable. It is not fixable by them, which is exactly why it has to be
        // said rather than left as a cell that never moves.
        ...(blocking
          ? { state: 'blocked', checked_at: now, reason: `Amazon does not sell this product in ${country}` }
          : { reason: null }),
      }).in('id', g.ids.slice(i, i + 200))
    }
  }
  return { answered: withAnswer.length, blocked }
}

/** Does this video already carry the market's language. */
async function checks(sb: Sb): Promise<{ ready: number; needsDub: number; unknown: number }> {
  if (!ingestConfigured()) return { ready: 0, needsDub: 0, unknown: 0 }

  // STOCK FIRST, ENFORCED HERE. Everything past this point costs render minutes,
  // and `.not('stock', 'is', null)` is what stops them being spent on a product
  // the country has never sold. Dropping this clause puts the old ordering back
  // without changing anything that is visible on a screen.
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,video_id,domain,asin,stock').eq('state', 'unknown')
    .not('asin', 'is', null).not('stock', 'is', null)
    .order('priority', { ascending: false }).limit(CHECKS * 9)

  // Grouped by video: ONE track-list lookup answers every market at once, so
  // checking per cell pays for the same call up to nine times.
  const groups = new Map<string, Array<{ id: string; domain: string; stock: string | null }>>()
  for (const c of (cells ?? [])) {
    if (!groups.has(c.video_id) && groups.size >= CHECKS) continue
    groups.set(c.video_id, [...(groups.get(c.video_id) ?? []), { id: c.id, domain: c.domain, stock: c.stock ?? null }])
  }
  if (groups.size === 0) return { ready: 0, needsDub: 0, unknown: 0 }

  const { data: vids } = await sb.from('youtube_videos')
    .select(`${AUDIO_COLUMNS},published_at`).in('id', [...groups.keys()])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vById = new Map<string, any>()
  for (const v of (vids ?? [])) vById.set(v.id, v)

  let ready = 0, needsDub = 0, unknown = 0
  const now = new Date().toISOString()

  for (const [videoId, cellList] of groups) {
    const v = vById.get(videoId)
    if (!v?.youtube_video_id) {
      await sb.from('storefront_coverage').update({
        state: 'blocked', reason: 'not on YouTube, so there is no audio to pull',
        checked_at: now, updated_at: now,
      }).in('id', cellList.map((c) => c.id))
      continue
    }

    // ONE LOOKUP, REMEMBERED. This is the call the dub lane used to repeat once
    // per market, so answering it here and storing it on the video means the
    // grid pays for it and Launchpad gets it free for a week.
    const langs = await audioLanguagesFor(sb, v)
    if (!langs) {
      // NOBODY LOOKED. Left unknown so the next firing retries, never recorded
      // as a finding about the video.
      unknown++
      continue
    }

    for (const cell of cellList) {
      const market = marketByDomain(cell.domain)
      const lang = (market?.lang || '').split('-')[0].toLowerCase()
      const dubbed = !!market && !!lang && carriesLanguage(langs, lang)
      await sb.from('storefront_coverage').update({
        state: 'preparing',
        // Which voice it will ship with, decided here so the screen never has
        // to guess: YouTube's own track when it exists, ours when it does not.
        voice: dubbed ? 'youtube' : 'standard',
        reason: null,
        checked_at: now, updated_at: now,
        // THE REAL STOCK ANSWER, from the pass that actually asked. This used to
        // pass `dubbed` as `inStock`, so "YouTube already has French" and "the
        // product is buyable in France" landed in the same slot in the ordering
        // while the column comment and the screen both said the number meant
        // stock. They are different facts, and they are now two terms.
        priority: coveragePriority({
          publishedAt: v.published_at,
          inStock: cell.stock === 'in_stock',
          alreadyDubbed: dubbed,
        }),
      }).eq('id', cell.id)
      if (dubbed) ready++; else needsDub++
    }
  }
  return { ready, needsDub, unknown }
}

/** Videos handed to the storefront pipeline per firing. */
const PREPARE = 6

/**
 * Hand a prepared cell to the existing storefront pipeline.
 *
 * IT CREATES THE JOB AND WALKS AWAY. /api/global-sync/start needs a signed-in
 * creator, and a drain nobody is watching has no session. But the localizing
 * does not need one: /api/cron/drain-global-sync already claims any job that
 * nothing has touched for five minutes and finishes it, which exists because
 * that route's own background loop dies when Vercel freezes the function.
 *
 * So this writes exactly the rows start/ writes and lets the recovery cron do
 * the work. No second pipeline, no internal endpoint to keep in step, and the
 * localizing and the thumbnail are the same ones a single video gets.
 *
 * THE DUB IS NOT ONE OF THEM, and believing it was is what made this whole lane
 * dishonest. The recovery cron translates the title and description; nothing in
 * it dubs, because the dub needed a signed-in creator. So a cell went straight
 * to 'ready' and the delivery queue served the market the MASTER ENGLISH AUDIO
 * under a French title. dubs() below is what actually produces the audio, and a
 * market that needs one does NOT become ready here.
 *
 * One job per video carrying every market it is prepared for, because that
 * pipeline fans out internally and splitting it would re-render the same video
 * once per country.
 */
async function prepare(sb: Sb): Promise<{ sent: number; failed: number }> {
  // `sync_job_id is null` is what stops this re-claiming a cell that is waiting
  // on its dub. Those stay 'preparing' with a job attached, and a second job per
  // video would re-render everything a second time.
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,user_id,video_id,domain,asin').eq('state', 'preparing').is('sync_job_id', null)
    .order('priority', { ascending: false }).limit(PREPARE * 9)

  const groups = new Map<string, { userId: string; asin: string | null; rows: Array<{ id: string; domain: string }> }>()
  for (const c of (cells ?? [])) {
    if (!groups.has(c.video_id) && groups.size >= PREPARE) continue
    const g = groups.get(c.video_id)
      ?? { userId: c.user_id as string, asin: (c.asin as string | null) ?? null, rows: [] as Array<{ id: string; domain: string }> }
    g.rows.push({ id: c.id, domain: c.domain })
    groups.set(c.video_id, g)
  }
  if (groups.size === 0) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0
  const now = new Date().toISOString()

  for (const [videoId, g] of groups) {
    const ids = g.rows.map((r) => r.id)
    const { data: job, error: jobErr } = await sb.from('global_sync_jobs')
      .insert({ user_id: g.userId, video_id: videoId, asin: g.asin, status: 'localizing' })
      .select('id').single()
    if (jobErr || !job) {
      // NAMED, in the database's own words. A bare "failed" is a second screen
      // that knows something broke and not what.
      await sb.from('storefront_coverage').update({
        reason: `could not open a sync job yet (${jobErr?.message ?? 'unknown'})`.slice(0, 200),
        updated_at: now,
      }).in('id', ids)
      failed++
      continue
    }

    const targets = g.rows.map((r) => {
      const mkt = marketByDomain(r.domain)!
      return {
        job_id: job.id, user_id: g.userId, domain: r.domain,
        lang: mkt.lang, dub: mkt.needsTranslation, asin: g.asin, state: 'pending' as const,
      }
    })
    const { error: tErr } = await sb.from('global_sync_targets').insert(targets)
    if (tErr) {
      await sb.from('storefront_coverage').update({
        reason: `could not open the per-country rows yet (${tErr.message})`.slice(0, 200),
        updated_at: now,
      }).in('id', ids)
      failed++
      continue
    }

    // ── HAND IT OVER NOW, NOT IN FIVE MINUTES ────────────────────────────
    //
    // drain-global-sync only claims a job nothing has touched for five minutes,
    // and that window exists for one reason: never race the request that is
    // still doing the work. There is no request here. Nobody is driving this
    // job, and nobody ever will be, so the whole window is dead time a creator
    // pays on every batch of six videos, forever.
    //
    // Backdating `updated_at` past the window hands it over on the next tick.
    // AFTER the targets are inserted, never before: a job with no targets yet
    // reads as "nothing left to localize" and the recovery cron would close it
    // out as done, taking every market on it with it.
    const handOver = new Date(Date.now() - STALL_AFTER_MS - 60_000).toISOString()
    await sb.from('global_sync_jobs').update({ updated_at: handOver }).eq('id', job.id)

    // READY ONLY WHERE READY IS TRUE. An English storefront takes the master
    // as it is, so it is ready the moment the copy is queued. A market that
    // needs a dub is not ready until the audio exists, and dubs() promotes it.
    // Marking both here is what let English audio reach amazon.fr under a
    // French title while the board reported it as ready to upload.
    const englishIds = g.rows.filter((r) => !marketByDomain(r.domain)?.needsTranslation).map((r) => r.id)
    const dubIds = g.rows.filter((r) => marketByDomain(r.domain)?.needsTranslation).map((r) => r.id)
    if (englishIds.length > 0) {
      await sb.from('storefront_coverage')
        .update({ state: 'ready', sync_job_id: job.id, reason: null, updated_at: now }).in('id', englishIds)
    }
    if (dubIds.length > 0) {
      await sb.from('storefront_coverage')
        .update({ sync_job_id: job.id, reason: null, updated_at: now }).in('id', dubIds)
    }
    sent++
  }
  return { sent, failed }
}

// ── the dub ─────────────────────────────────────────────────────────────────
/** Markets dubbed per firing. One dub is a transcription, a translation, a
 *  synthesis and a mux, so this is deliberately one at a time: a second in the
 *  same tick would run the 300 second budget out mid-render. */
const DUBS = 1
/** Tries before a cell stops asking. A render service hiccup deserves another
 *  go; a video whose audio simply cannot be produced should say so rather than
 *  retry every minute forever. */
const DUB_TRIES = 3

/**
 * Produce the audio a non-English market actually needs.
 *
 * THIS IS WHAT WAS MISSING. The dub lived behind /api/global-sync/dub, which
 * requires a signed-in creator, and the only caller was the browser. So the
 * background grid created the job, the recovery cron translated the title and
 * description, and the cell went to 'ready' with no dub at all. The delivery
 * queue falls back to the master when a target has no video_url, so amazon.fr
 * would have received a French title, a French description and English audio,
 * reported as ready the whole way.
 *
 * ONE LANE, SHARED. dubTarget is the same function the browser calls, so the
 * ordering that matters (YouTube's own track first, ours second) cannot drift
 * between the two callers. Copying it here is what would have made it drift,
 * and nothing on any screen would have shown it.
 *
 * ALWAYS THE FREE VOICE. requestedStandard spends no cloned-voice credit, and
 * nobody is present to agree to spending one. It also makes YouTube's existing
 * track eligible, which is the cheapest outcome of all.
 */
async function dubs(sb: Sb): Promise<{ dubbed: number; blocked: number; failed: number }> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,user_id,domain,sync_job_id,dub_attempts,video_id')
    .eq('state', 'preparing').not('sync_job_id', 'is', null)
    .order('priority', { ascending: false }).limit(DUBS * 4)
  const rows = cells ?? []
  if (rows.length === 0) return { dubbed: 0, blocked: 0, failed: 0 }

  let dubbed = 0, blocked = 0, failed = 0
  const now = new Date().toISOString()
  let budget = DUBS

  for (const c of rows) {
    if (budget <= 0) break
    const mkt = marketByDomain(c.domain)
    if (!mkt) continue

    // An English market should never be sitting here, but if one is, it is
    // ready and not waiting on anything.
    if (!mkt.needsTranslation) {
      await sb.from('storefront_coverage')
        .update({ state: 'ready', reason: null, updated_at: now }).eq('id', c.id)
      dubbed++
      continue
    }

    const { data: target } = await sb.from('global_sync_targets')
      .select('id,state,video_url,detail').eq('job_id', c.sync_job_id).eq('domain', c.domain).maybeSingle()

    // The copy has not been translated yet. The recovery cron gets to it; this
    // cell simply is not this step's turn, and touching it would be inventing
    // news.
    if (!target) continue
    if (target.state === 'pending') continue

    // Already has audio, from this lane or from the creator's own browser.
    if (target.video_url) {
      await sb.from('storefront_coverage')
        .update({ state: 'ready', reason: null, updated_at: now }).eq('id', c.id)
      dubbed++
      continue
    }

    const tries = Number(c.dub_attempts ?? 0)
    if (tries >= DUB_TRIES) {
      // BLOCKED, in the pipeline's own words. A cell that has given up must say
      // so: sitting in 'preparing' forever is the silence that looks exactly
      // like work in progress.
      await sb.from('storefront_coverage').update({
        state: 'blocked',
        reason: `could not produce the ${mkt.langName} audio after ${tries} tries (${target.detail || 'no reason recorded'})`.slice(0, 200),
        checked_at: now, updated_at: now,
      }).eq('id', c.id)
      blocked++
      continue
    }

    // Counted BEFORE the attempt. A dub that kills the function mid-render
    // would otherwise never record the try, and the cell would retry forever.
    await sb.from('storefront_coverage')
      .update({ dub_attempts: tries + 1, updated_at: now }).eq('id', c.id)
    budget--

    const { data: integ } = await sb.from('integrations')
      .select('tier,subscription_period_start').eq('user_id', c.user_id).maybeSingle()

    const res = await dubTarget({
      sb,
      userId: c.user_id,
      tier: normalizeTier(integ?.tier),
      jobId: c.sync_job_id,
      domain: c.domain,
      // NEVER A CREDIT IN THE BACKGROUND. Nobody is here to agree to spending
      // one, and the standard voice is free and unlimited.
      requestedStandard: true,
      periodStart: (integ?.subscription_period_start as string | null) ?? null,
    })

    if (res.ok) {
      await sb.from('storefront_coverage').update({
        state: 'ready',
        // WHOSE VOICE, recorded from what actually ran rather than from what
        // was asked for. A YouTube track and our own synthesis are the same
        // URL from the outside.
        voice: res.voice,
        reason: null, checked_at: now, updated_at: now,
      }).eq('id', c.id)
      dubbed++
    } else if (res.noTranscript) {
      // Not going to fix itself. The creator has to add a transcript or a
      // source video, so the cell says that instead of trying twice more.
      await sb.from('storefront_coverage').update({
        state: 'blocked',
        reason: 'this video has no transcript yet, so there is nothing to translate into speech',
        checked_at: now, updated_at: now,
      }).eq('id', c.id)
      blocked++
    } else {
      await sb.from('storefront_coverage')
        .update({ reason: res.error.slice(0, 200), updated_at: now }).eq('id', c.id)
      failed++
    }
  }
  return { dubbed, blocked, failed }
}

/**
 * Read back what actually happened to everything handed over.
 *
 * READ FROM THE TARGET, not from whoever wrote it. A global_sync_target reaches
 * 'failed' from at least three places and 'delivered' from SCOUT. Teaching each
 * of them about coverage is the twenty-copies mistake; one pass reads the
 * target's state whoever set it.
 *
 * `uploaded` is as far as this can honestly go. SCOUT finished the upload; that
 * is not the same as the video being on the product page, and `live` is set
 * only when it is afterwards found there.
 */
async function reconcile(sb: Sb): Promise<number> {
  const { data: cells } = await sb.from('storefront_coverage')
    .select('id,sync_job_id,domain').in('state', ['ready', 'uploading'])
    .not('sync_job_id', 'is', null).limit(300)
  const rows = cells ?? []
  if (rows.length === 0) return 0

  const { data: targets } = await sb.from('global_sync_targets')
    .select('job_id,domain,state,detail')
    .in('job_id', [...new Set(rows.map((r: { sync_job_id: string }) => r.sync_job_id))])
  const byKey = new Map<string, { state: string; detail: string | null }>()
  for (const t of (targets ?? [])) byKey.set(`${t.job_id}:${t.domain}`, { state: t.state, detail: t.detail })

  let moved = 0
  const now = new Date().toISOString()
  for (const c of rows) {
    const t = byKey.get(`${c.sync_job_id}:${c.domain}`)
    if (!t) continue
    if (t.state === 'delivered') {
      await sb.from('storefront_coverage')
        .update({ state: 'uploaded', reason: null, updated_at: now }).eq('id', c.id)
      moved++
    } else if (t.state === 'failed') {
      await sb.from('storefront_coverage').update({
        state: 'blocked',
        reason: (t.detail || 'the storefront upload failed without saying why').slice(0, 200),
        updated_at: now,
      }).eq('id', c.id)
      moved++
    }
  }
  return moved
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient() as Sb
  // RECONCILE FIRST. A listing that went live is not news that should wait
  // behind a channel enrolment on a catalogue of three thousand.
  const reconciled = await reconcile(sb)
  const enrolled = await enrol(sb)
  const product = await products(sb)
  // EXISTENCE BEFORE THE DUB. checks() starts the localizing that prepare()
  // hands to the render pipeline, and neither of them can produce a listing for
  // a product the country has never sold. This is also enforced in the claim
  // query rather than only by the order of these lines, because a reordering
  // here would otherwise be invisible.
  const stocked = await stock(sb)
  const checked = await checks(sb)
  const prepared = await prepare(sb)
  // LAST, and the only step that can use the whole remaining budget. A dub is a
  // transcription, a translation, a synthesis and a mux, so putting it ahead of
  // the cheap steps would mean a single slow render starves the grid.
  const audio = await dubs(sb)

  return NextResponse.json({ ok: true, reconciled, enrolled, product, stock: stocked, checked, prepared, audio })
}
