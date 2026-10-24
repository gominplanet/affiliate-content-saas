// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/trybe-directory — reads TRYBE brands' own websites, a few at
// a time, into the shared TRYBE directory (migration 417).
//
// So a creator's keywords can match what a brand actually sells ("bible"
// finds a brand through its product "Bible Journaling Kit"), each brand's
// website is read once: its home page text and, for most of these stores,
// Shopify's public product list. Brands in TRYBE's Top 100 first, then the
// newest (TRYBE gives no score to order by). A site that could
// not be read is stamped with why and not asked again for a month.
//
// HOW KNOWN EACH BRAND IS (migration 452, lib/brand-popularity; Seb,
// 2026-10-21): its website's rank among the world's websites (the Tranco
// list, one question a second) and what Google suggests after its name. Read
// first each run for about 45 seconds, rated brands first, about 240
// brands an hour, again after two weeks. A source that did not answer leaves
// the brand not read, and after two misses in a row it is not asked again
// that run.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { researchBrandSite, normalizeSite, type SiteResearch } from '@/lib/trybe-research'
import { siteSocials } from '@/lib/trybe-pick'
import { safeFetch } from '@/lib/ssrf-guard'
import { siteSearchText } from '@/lib/trybe-directory'
import { siteDomain, fetchWebRank, googleSeed, brandSearches, POPULARITY_FRESH_MS } from '@/lib/brand-popularity'
import { suggest } from '@/lib/search-suggest'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Brands read per run, and at once: about 360 an hour, so the ~5,900
 *  websites on TRYBE are all read within a day of the first collection. */
const PER_RUN = 60
const AT_ONCE = 10
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
/** Older website reads given the TikTok check per run. */
const SOCIALS_PER_RUN = 80
/** A read that failed is tried again after this long. */
const RETRY_FAILED_MS = 30 * 86_400_000
/** Stop starting new reads this close to the time limit. */
const BUDGET_MS = 95_000
/** The popularity reads' share of each run, and brands asked per source. */
const POP_BUDGET_MS = 45_000
const POP_PER_RUN = 40
/** Tranco answers one question a second. */
const TRANCO_GAP_MS = 1_100
const GOOGLE_GAP_MS = 600
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

type PopRow = { brand_id: string; name: string; website: string | null }
interface PopRun { web: { read: number; notRanked: number; shared: number; missed: number }; google: { read: number; missed: number }; missing?: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function popularityPass(sb: any, started: number): Promise<PopRun> {
  const run: PopRun = { web: { read: 0, notRanked: 0, shared: 0, missed: 0 }, google: { read: 0, missed: 0 } }
  const until = started + POP_BUDGET_MS
  const stale = new Date(Date.now() - POPULARITY_FRESH_MS).toISOString()
  // Never read first (Top 100 brands, then the newest), then the oldest reads.
  // Brands creators rated on TRYBE first (Star brands lists them; Seb's
  // test 2026-10-21 showed 5 of its 405 read): TRYBE's list has no score to
  // order by, so trybe_score put them anywhere.
  const todo = async (col: 'web_rank_checked_at' | 'google_checked_at'): Promise<PopRow[] | null> => {
    const { data: rated, error } = await sb.from('trybe_directory').select('brand_id, name, website').is(col, null)
      .not('raw->>reviewRating', 'is', null).limit(POP_PER_RUN)
    if (error) { if (/does not exist|schema cache/i.test(error.message)) run.missing = true; return null }
    let rows = (rated || []) as PopRow[]
    if (rows.length < POP_PER_RUN) {
      const { data: rest } = await sb.from('trybe_directory').select('brand_id, name, website').is(col, null)
        .order('top100_hits', { ascending: false, nullsFirst: false }).order('first_seen_at', { ascending: false, nullsFirst: false }).limit(POP_PER_RUN - rows.length)
      rows = rows.concat((rest || []) as PopRow[])
    }
    if (rows.length < POP_PER_RUN) {
      const { data: old } = await sb.from('trybe_directory').select('brand_id, name, website').lt(col, stale)
        .order(col, { ascending: true }).limit(POP_PER_RUN - rows.length)
      rows = rows.concat((old || []) as PopRow[])
    }
    return rows
  }
  const [webRows, googleRows] = await Promise.all([todo('web_rank_checked_at'), todo('google_checked_at')])

  const web = async () => {
    let missedInRow = 0
    for (const r of webRows || []) {
      if (Date.now() > until || missedInRow >= 2) break
      const domain = siteDomain(r.website)
      const stamp = { web_rank_checked_at: new Date().toISOString() }
      // No website of its own (none, or a page on Amazon, Etsy, a link page):
      // stamped with no domain, without asking.
      if (!domain) { await sb.from('trybe_directory').update({ ...stamp, web_domain: null, web_rank: null, web_rank_was: null, web_rank_days: null }).eq('brand_id', r.brand_id); run.web.shared++; continue }
      const rank = await fetchWebRank(domain)
      if (!rank) { run.web.missed++; missedInRow++; await wait(TRANCO_GAP_MS); continue }
      missedInRow = 0
      await sb.from('trybe_directory').update({ ...stamp, web_domain: domain, web_rank: rank.rank, web_rank_was: rank.was, web_rank_days: rank.days }).eq('brand_id', r.brand_id)
      if (rank.rank == null) run.web.notRanked++; else run.web.read++
      await wait(TRANCO_GAP_MS)
    }
  }
  const google = async () => {
    let missedInRow = 0
    for (const r of googleRows || []) {
      if (Date.now() > until || missedInRow >= 2) break
      const seed = googleSeed(r.name)
      if (seed.length < 3) { await sb.from('trybe_directory').update({ google_checked_at: new Date().toISOString(), google_searches: null, google_phrases: [] }).eq('brand_id', r.brand_id); continue }
      const s = await suggest('google', seed, sb)
      if (!s.answered) { run.google.missed++; missedInRow++; await wait(GOOGLE_GAP_MS); continue }
      missedInRow = 0
      const found = brandSearches(r.name, s.phrases)
      await sb.from('trybe_directory').update({ google_checked_at: new Date().toISOString(), google_searches: found.length, google_phrases: found }).eq('brand_id', r.brand_id)
      run.google.read++
      if (!s.remembered) await wait(GOOGLE_GAP_MS)
    }
  }
  await Promise.all([web(), google()])
  return run
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const started = Date.now()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  // Before migration 452 this reads nothing and says so in its answer.
  const popularity = await popularityPass(sb, started).catch((e) => ({ error: e instanceof Error ? e.message : 'error' }))
  const { data: fresh, error } = await sb.from('trybe_directory')
    .select('brand_id, website')
    .is('site_fetched_at', null).not('website', 'is', null)
    .order('top100_hits', { ascending: false, nullsFirst: false }).order('first_seen_at', { ascending: false, nullsFirst: false })
    .limit(PER_RUN)
  if (error) {
    // Before migration 417 there is nothing to read: said, not thrown.
    return NextResponse.json({ ok: false, error: error.message }, { status: /does not exist|schema cache/i.test(error.message) ? 200 : 500 })
  }
  let rows = (fresh || []) as Array<{ brand_id: string; website: string }>
  if (rows.length < PER_RUN) {
    const { data: again } = await sb.from('trybe_directory')
      .select('brand_id, website')
      .not('site_error', 'is', null).not('website', 'is', null)
      .lt('site_fetched_at', new Date(Date.now() - RETRY_FAILED_MS).toISOString())
      .limit(PER_RUN - rows.length)
    rows = rows.concat((again || []) as Array<{ brand_id: string; website: string }>)
  }

  let read = 0, failed = 0
  for (let i = 0; i < rows.length && Date.now() - started < BUDGET_MS; i += AT_ONCE) {
    await Promise.all(rows.slice(i, i + AT_ONCE).map(async (r) => {
      const res: SiteResearch = await researchBrandSite(r.website).catch((e) => ({ summary: '', products: [] as string[], error: e instanceof Error ? e.message : 'error' }))
      const ok = !!(res.summary || res.products.length)
      ok ? read++ : failed++
      const { error: upErr } = await sb.from('trybe_directory').update({
        site_summary: res.summary || null,
        site_products: res.products,
        site_text: ok ? siteSearchText(res.summary, res.products) : null,
        site_error: ok ? null : (res.error || 'Nothing readable on the website.'),
        site_fetched_at: new Date().toISOString(),
      }).eq('brand_id', r.brand_id)
      // A WRITE THAT FAILED STILL STAMPS THE ROW, with why: otherwise every run
      // read the same sixty sites again and never moved past them.
      if (upErr) {
        await sb.from('trybe_directory').update({ site_error: `MVP could not save what it read: ${upErr.message}`.slice(0, 300), site_fetched_at: new Date().toISOString() }).eq('brand_id', r.brand_id)
      }
      // TikTok on the home page (migration 425), saved on its own so a
      // database without those columns never costs the website read above.
      if (res.socials) {
        await sb.from('trybe_directory').update({ tiktok_handle: res.socials.tiktokHandle, tiktok_shop: res.socials.tiktokShop, socials_checked_at: new Date().toISOString() }).eq('brand_id', r.brand_id)
      }
    }))
  }

  // WEBSITES READ BEFORE THE TIKTOK CHECK (migration 425): the home page only,
  // for whether the brand is on TikTok or TikTok Shop (Cole: brands not on
  // TikTok have less competition). Before the migration this finds nothing.
  let socials = 0
  if (Date.now() - started < BUDGET_MS) {
    const { data: older } = await sb.from('trybe_directory')
      .select('brand_id, website')
      .is('socials_checked_at', null).not('site_fetched_at', 'is', null).is('site_error', null).not('website', 'is', null)
      .order('top100_hits', { ascending: false, nullsFirst: false }).order('first_seen_at', { ascending: false, nullsFirst: false })
      .limit(SOCIALS_PER_RUN)
    const list = (older || []) as Array<{ brand_id: string; website: string }>
    for (let i = 0; i < list.length && Date.now() - started < BUDGET_MS; i += AT_ONCE) {
      await Promise.all(list.slice(i, i + AT_ONCE).map(async (r) => {
        const url = normalizeSite(r.website)
        let found: { tiktokHandle: string | null; tiktokShop: boolean } | null = null
        try {
          const res = url ? await safeFetch(url, { headers: { accept: 'text/html', 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(10_000) }) : null
          const html = res && res.ok ? (await res.text()).slice(0, 600_000) : ''
          const s = html ? siteSocials(html) : null
          // "Not on TikTok" only from what is plainly the brand's real page: a
          // bot check or consent wall that answers 200 says nothing either way.
          const realPage = /<title[^>]*>[^<]{2,}<\/title>/i.test(html) && html.length > 3000
          if (s && (s.tiktokHandle || s.tiktokShop || realPage)) found = s
        } catch { /* stamped below as checked, with nothing found */ }
        // A home page that would not load is stamped too, as unknown, so the
        // same pages are not asked every run.
        await sb.from('trybe_directory').update(found
          ? { tiktok_handle: found.tiktokHandle, tiktok_shop: found.tiktokShop, socials_checked_at: new Date().toISOString() }
          : { socials_checked_at: new Date().toISOString() }).eq('brand_id', r.brand_id)
        if (found) socials++
      }))
    }
  }
  return NextResponse.json({ ok: true, asked: rows.length, read, failed, socials, popularity, ms: Date.now() - started })
}
