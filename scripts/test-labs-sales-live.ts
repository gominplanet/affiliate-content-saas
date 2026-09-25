// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for two Labs previews: "On sale now" and "Amazon Live prep".

import { readFileSync } from 'node:fs'
import { saleVerdict, SALE_MIN_PCT, saleLabel, visibilityFromItem, applyVisibility, notPublicMessage, pickLookups, type CoverSource } from '../lib/covered-sales'
import { layoutClock, assemblePlan, tidyLine, clockLabel, LIVE_MAX_PRODUCTS } from '../lib/live-plan'
import { canUsePreview } from '../lib/labs-preview'
import { lastingBody, commentWithLink, SALE_WORDING, salesNow, DISCLOSURE, PRICE_LINE_LEAD, SALE_COMMENTS_PER_DAY } from '../lib/sale-comments'
import { tidyCopy } from '../lib/copy-rules'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrderCheck = (src: string, a: string, b: string) => { const i = src.indexOf(a), j = src.indexOf(b); return i > -1 && j > -1 && i < j }

// ── the house rules for copy ────────────────────────────────────────────────
{
  const now = new Date('2026-09-25T00:00:00Z')
  check('a range stays a range, and a spec number survives',
    tidyCopy('Runs 3–5 hours on 2000 mAh', now) === 'Runs 3 to 5 hours on 2000 mAh', tidyCopy('Runs 3–5 hours on 2000 mAh', now))
  check('this year and next are removed, dashes become commas, "honest" goes',
    !/2026|2027/.test(tidyCopy('Best of 2026, and the 2027 model', now))
    && tidyCopy('Look at this - wow', now) === 'Look at this, wow'
    && !/honest/i.test(tidyCopy('I am honestly impressed', now)) && !/honest/i.test(tidyCopy('Its honesty shows', now)))
  check('a spaced hyphen between numbers is a range, and nothing starts with a comma',
    tidyCopy('20 - 30% off', now) === '20 to 30% off' && !/^,/.test(tidyCopy('Honestly — this', now)))
}

// ── preview gate: only the owner sees these until they are opened ───────────
check('On sale now is open to Pro (and admin) only, and Amazon Live prep is still admin only',
  canUsePreview('on_sale', 'admin') && canUsePreview('on_sale', 'pro') && !canUsePreview('on_sale', 'trial')
  && !canUsePreview('on_sale', 'creator') && !canUsePreview('on_sale', 'agency')
  && canUsePreview('amazon_live', 'admin') && !canUsePreview('amazon_live', 'pro'),
  'the wrong tiers would see a feature')
{
  const SHELL = read('components/layout/DashboardShellV2.tsx')
  check('and the nav follows the same switch',
    /href: '\/encore'[^\n]*label: 'Encore', gate: previewOpenToPro\('on_sale'\) \? isPro : isAdmin/.test(SHELL)
    // Encore sits in Create, beside Co-Pilot, not in Labs.
    && SHELL.indexOf("href: '/encore'") > SHELL.indexOf("label: 'Create'") && SHELL.indexOf("href: '/encore'") < SHELL.indexOf("label: 'Labs'")
    && /href: '\/amazon-live'[^\n]*gate: previewOpenToPro\('amazon_live'\) \? isPro : isAdmin/.test(SHELL),
    'a nav gated on Pro shows a page whose routes refuse')
  for (const f of ['app/api/on-sale/route.ts', 'app/api/on-sale/promo/route.ts', 'app/api/on-sale/comment/route.ts']) {
    check(`${f} is gated on the preview`, /canUsePreview\('on_sale'/.test(read(f)) && !/canSeeNav\('labs'/.test(read(f)))
  }
  for (const f of ['app/api/live/products/route.ts', 'app/api/live/plan/route.ts', 'app/api/live/plans/route.ts', 'app/api/live/plans/[id]/route.ts']) {
    check(`${f} is gated on the preview`, /canUsePreview\('amazon_live'/.test(read(f)))
  }
  check('the daily alert job only alerts creators who have the feature',
    /filter\(\(r\) => canUsePreview\('on_sale', r\.tier\)\)/.test(read('app/api/cron/covered-sales/route.ts')),
    'every Pro dashboard would fill with alerts for a feature they cannot open')
}

// ── On sale now: the rule ───────────────────────────────────────────────────
const deal = (o: Partial<{ discount_pct: number | null; deal_type: string; lightning_ends_at: string | null }>) => ({
  discount_pct: null, price_now_cents: 1000, price_was_cents: 1500, deal_type: 'price_drop', lightning_ends_at: null, ...o,
})
check('a real sale counts, a small move does not',
  saleVerdict({ deal: deal({ discount_pct: SALE_MIN_PCT }) }).onSale
  && !saleVerdict({ deal: deal({ discount_pct: SALE_MIN_PCT - 1 }) }).onSale,
  `the line is ${SALE_MIN_PCT}%`)
check('a live lightning deal counts, an ended one does not',
  saleVerdict({ deal: deal({ deal_type: 'lightning', lightning_ends_at: new Date(Date.now() + 3600_000).toISOString() }) }).basis === 'lightning'
  && !saleVerdict({ deal: deal({ deal_type: 'lightning', lightning_ends_at: new Date(Date.now() - 60_000).toISOString() }) }).onSale)
check('Keepa decides when the shared cache has nothing',
  saleVerdict({ keepa: { priceNowCents: 800, priceAvg90Cents: 1000, priceLowestCents: 700, discountPct: 20 } }).onSale
  && !saleVerdict({ keepa: { priceNowCents: 950, priceAvg90Cents: 1000, priceLowestCents: 700, discountPct: 5 } }).onSale
  && saleVerdict({ keepa: { priceNowCents: 690, priceAvg90Cents: 730, priceLowestCents: 700, discountPct: 6 } }).allTimeLow,
  'a new all-time low is news even when it is a small cut')
check('no data is no sale', !saleVerdict({}).onSale && !saleVerdict({ keepa: { priceNowCents: null, priceAvg90Cents: null, priceLowestCents: null, discountPct: null } }).onSale)
check('the label is words, not a guess', saleLabel(saleVerdict({ deal: deal({ discount_pct: 30 }) })) === '30% off')
{
  const LIB = read('lib/covered-sales.ts')
  check('the free shared cache is read before any Keepa token is spent',
    LIB.indexOf("from('deal_radar_cache')") > -1 && LIB.indexOf("from('deal_radar_cache')") < LIB.indexOf('fetchKeepaBasicsCached(admin, rest')
    && /\.filter\(\(p\) => !deals\.has\(p\.asin\)\)/.test(LIB) && /const rest = pickLookups\(videoFirst, inVideo, fresh, \{ cap: opts\?\.keepaCap \?\? 50, videoCap: opts\?\.videoKeepaCap \}\)/.test(LIB)
    // Products already in the day-old cache are free and always included, so
    // each check reaches 50 NEW products instead of re-reading the first 50.
    && /return \[\.\.\.cached, \.\.\.unseen\.slice\(0, caps\.cap\)\]/.test(LIB) && /return \[\.\.\.cached, \.\.\.videos, \.\.\.store\]/.test(LIB),
    'a creator with a big catalogue would spend the day\'s Keepa budget on products the cache already knew')
  const PROMO = read('app/api/on-sale/promo/route.ts')
  check('the promo never states a price or a percentage, and never names a sale event',
    /NEVER state a price, a dollar amount, or a percentage/.test(PROMO) && /Do NOT name any Amazon sale event/.test(PROMO)
    && !/detectOccasion|canNameEvent/.test(PROMO),
    'a sale price is true for hours, and "it is October so it is Prime" is a false claim on a real video')
  check('a price that could not be checked is not reported as a sale that ended',
    /if \(!sale && checked === 0\)/.test(PROMO) && inOrderCheck(PROMO, 'if (!sale && checked === 0)', "This one is not on sale any more"))
  check('the comment route asks YouTube whose video it is when the record does not say',
    /yt\.getVideoStatus\(videoId\)/.test(read('app/api/on-sale/comment/route.ts'))
    && /if \(!\/\^UC\[\\w-\]\{22\}\$\/\.test\(owner\)\) owner = status\.channelId/.test(read('app/api/on-sale/comment/route.ts')))
  check('no promo for a product that is no longer on sale',
    /if \(!sale\) \{\s*return NextResponse\.json\(\{ error: 'This one is not on sale any more/.test(PROMO),
    'a comment saying "on sale right now" would sit on the video saying something untrue')
  check('and its copy goes through the shared house rules',
    /const tidy = \(s: unknown\) => tidyCopy\(s\)/.test(PROMO) && /return tidyCopy\(s\)/.test(read('lib/live-plan.ts')))
  check('the creator\'s banned words reach the prompt (the column is text, not an array)',
    /String\(raw \?\? ''\)\.split\(/.test(PROMO) && /const avoid = avoidList\(brand\?\.words_to_avoid\)/.test(PROMO))
  check('the comment and Community post always end with the price line and the Associates disclosure, written by code; the social sheet gets the post without a second link',
    /const priceLine = `\$\{PRICE_LINE_LEAD\} \$\{link\}`/.test(PROMO) && /const disclosure = DISCLOSURE/.test(PROMO)
    && PRICE_LINE_LEAD === 'Check the latest price on Amazon here:' && DISCLOSURE === 'As an Amazon Associate I earn from qualifying purchases.'
    && /const comment = commentWithLink\(strip\(j\.comment \?\? ''\), link\)/.test(PROMO)
    && /const commentLasting = commentWithLink\(lastingBody\(j\.commentAfter, productTitle\), link\)/.test(PROMO)
    && /\$\{priceLine\}\\n\$\{disclosure\}`/.test(PROMO.slice(PROMO.indexOf('const community ='))) && /socialForSheet:/.test(PROMO)
    && /promo\.promo\.socialForSheet/.test(read('components/labs/OnSale.tsx')))
  const CMT = read('app/api/on-sale/comment/route.ts')
  check('the comment is posted only as the video\'s own channel, asked of YouTube',
    /me\.id !== owner/.test(CMT) && inOrderCheck(CMT, 'me.id !== owner', 'yt.postComment('),
    'a login can fall back to the default channel, and the comment would come from somebody else')
  check('a comment only ever goes on the creator\'s own video, through that video\'s channel',
    /from\('youtube_videos'\)\s*\.select\('id,channel_id,title'\)\.eq\('user_id', user\.id\)\.eq\('youtube_video_id', videoId\)/.test(CMT)
    && /getChannelOAuthToken\(supabase, user\.id, vid\.channel_id \?\? null\)/.test(CMT),
    'a comment on somebody else\'s video, or from the wrong channel, cannot be taken back quietly')
  const CRON = read('app/api/cron/covered-sales/route.ts')
  check('one alert per product per week unless the sale gets deeper',
    /const REALERT_DAYS = 7/.test(CRON) && /\(p\.verdict\.pct \?\? 0\) >= was \+ DEEPER_BY/.test(CRON)
    && /m \? Number\(m\[1\]\) : 100/.test(CRON))
  check('the job stops before Keepa runs dry for everyone else',
    /tokens\.tokensLeft != null && tokens\.tokensLeft < 150\) break/.test(CRON))
  const KC = read('lib/keepa-cache.ts')
  check('a Keepa batch that never answered is not cached as "no data"',
    /missing\.filter\(\(a\) => fetched\.has\(a\)\)/.test(KC) && !/empty: true, fetched_at: at/.test(KC),
    'one token-starved minute blanked a day of prices for every feature reading the shared cache')
  check('the page says how many were actually checked',
    /checked: stats\.checked/.test(read('app/api/on-sale/route.ts')) && /not checked yet\. Each <b>Check again<\/b> checks the next 50/.test(read('components/labs/OnSale.tsx')))
  check('rewriting the promo clears "Posted."', /setPosted\(null\)\s*\n\s*setPromo\(j as Promo\)/.test(read('components/labs/OnSale.tsx')))
  for (const [pg, feat] of [['app/(dashboard)/encore/page.tsx', 'on_sale'], ['app/(dashboard)/amazon-live/page.tsx', 'amazon_live']] as const) {
    check(`${pg} follows the preview switch`, new RegExp(`canUsePreview\\('${feat}', tier\\)`).test(read(pg)) && !/canSeeNav/.test(read(pg)))
  }
  check('the job is on the schedule', /"\/api\/cron\/covered-sales"/.test(read('vercel.json')))
  check('alerts show in the dashboard box', /a\.kind === 'covered_sale'/.test(read('components/dashboard/PriceAlertsPanel.tsx')))
}

// ── Amazon Live: the clock always adds up ───────────────────────────────────
for (const m of [30, 45, 60, 90, 120]) {
  for (const n of [1, 3, 7, 20, LIVE_MAX_PRODUCTS]) {
    // Only shows the route accepts: at least a minute a product plus 4.
    if (m < n + 4) continue
    const c = layoutClock(m, Array.from({ length: n }, (_, i) => ({ saleLabel: i % 2 ? 'x' : null })))
    const sum = c.opening + c.closing + c.segments.reduce((a, s) => a + s.minutes, 0)
    const contiguous = c.segments.every((s, i) => s.startMin === (i === 0 ? c.opening : c.segments[i - 1].startMin + c.segments[i - 1].minutes))
    check(`a ${m} minute show with ${n} products adds up`, sum === m && contiguous && c.segments.every((s) => s.minutes >= 1), `sum ${sum}`)
  }
}
{
  const products = [
    { asin: 'B0AAAAAAAA', title: 'First Thing', image: null, bullets: ['Point one', 'Point two'], transcript: '', videoTitle: null, saleLabel: null },
    { asin: 'B0BBBBBBBB', title: 'Second Thing', image: null, bullets: ['Only point'], transcript: '', videoTitle: 'My review', saleLabel: '20% off' },
  ]
  const plan = assemblePlan({ title: 'Kitchen - 2026 picks', minutes: 30, products, model: { products: [{ asin: 'B0BBBBBBBB', hook: 'Look at this — really', talkingPoints: ['It is honestly great'] }], chatPrompts: ['What do you cook?'] } })
  check('a product the writer skipped keeps its slot, with the listing\'s points',
    plan.segments.length === 2 && plan.segments[0].asin === 'B0AAAAAAAA' && plan.segments[0].talkingPoints[0] === 'Point one')
  check('the writer\'s words are cleaned: no dashes, no year, no "honest"',
    !/[—–]| - /.test(plan.segments[1].hook) && !/2026/.test(plan.title) && !/honest/i.test(plan.segments[1].talkingPoints.join(' ')),
    JSON.stringify({ hook: plan.segments[1].hook, title: plan.title, tp: plan.segments[1].talkingPoints }))
  check('chat prompts sit inside the show, not in the opening or the close',
    plan.chatPrompts.every((p) => p.atMin >= plan.opening.minutes && p.atMin < plan.closing.startMin))
  check('the clock reads like a clock', clockLabel(0) === '0:00' && clockLabel(65) === '1:05:00' && clockLabel(12) === '12:00')
  check('tidyLine keeps a normal sentence as it is', tidyLine('Grab it while it lasts.') === 'Grab it while it lasts.')
}
{
  const PLAN = read('app/api/live/plan/route.ts')
  const LIB = read('lib/live-plan.ts')
  check('the live script never states a price either', /NEVER state a price, a dollar amount, or a percentage/.test(LIB))
  check('a plan is still returned when it cannot be saved, and says so',
    /saved: !saveErr/.test(PLAN) && /needs migration 373/.test(PLAN) && /j\.saveError/.test(read('components/labs/AmazonLive.tsx')))
  check('products are capped so each gets real time', /asins\.length > LIVE_MAX_PRODUCTS/.test(PLAN) && /minutes < asins\.length \+ 4/.test(PLAN))
  check('a show holds up to 39 products, the size of the Amazon Live carousel', LIVE_MAX_PRODUCTS === 39)
  check('no giveaways, contests or prizes, whatever the notes say',
    /NEVER mention a giveaway, contest, sweepstake, raffle, prize/.test(LIB) && !/Giveaway/.test(read('components/labs/AmazonLive.tsx')),
    'Amazon Live does not allow them')
  const LP = read('app/api/live/products/route.ts')
  check('the products come from the storefront, with a video flag and what each earned',
    /from\('storefront_catalog'\)\.select\('asin,title,image_url,has_video'\)/.test(LP) && /from\('storefront_earnings'\)/.test(LP)
    && !/idea_lists/.test(LP) && /storefrontSynced/.test(LP),
    'a live show is products the creator has on hand')
  check('Suggest a lineup ranks on sale first, then earnings, then a video',
    /score: \(s \? 1_000_000 : 0\) \+ Math\.min\(earnedCents, 999_000\) \+ \(hasVideo \? 500 : 0\)/.test(LP)
    && /Suggest a lineup/.test(read('components/labs/AmazonLive.tsx')))
  check('the listings share one 30 second clock, and a cut-off reply is not a plan',
    /setTimeout\(res, 30_000\)/.test(PLAN) && /msg\.stop_reason === 'max_tokens'/.test(PLAN))
  check('the teleprompter measures "behind" against the next part\'s start',
    /const behind = started \? Math\.floor\(elapsed \/ 60\) - nextAt : 0/.test(read('components/labs/AmazonLive.tsx')))
  const M = read('supabase/migrations/373_on_sale_and_live_plans.sql')
  check('the tables are twice-runnable',
    /create table if not exists public\.covered_sale_checks/.test(M) && /create table if not exists public\.live_plans/.test(M)
    && /drop policy if exists "live_plans_own"/.test(M))
}

// ── a comment only where someone will read it ───────────────────────────────
{
  check('YouTube leaving a video out means not public, never public',
    visibilityFromItem({ status: { privacyStatus: 'public' } }) === 'public'
    && visibilityFromItem({ status: { privacyStatus: 'unlisted' } }) === 'unlisted'
    && visibilityFromItem(undefined) === 'not_public' && visibilityFromItem({ status: { privacyStatus: 'private' } }) === 'not_public')
  const v = { onSale: true, pct: 20, nowCents: 1, refCents: 2, basis: 'deal' as const, lightningEndsAt: null, allTimeLow: false }
  const vid = (id: string): CoverSource => ({ kind: 'video', youtubeVideoId: id })
  const ranked = applyVisibility([
    { asin: 'STORE00001', title: 's', image: null, sources: [{ kind: 'storefront' }] as CoverSource[], verdict: { ...v, pct: 60 } },
    { asin: 'PRIV000001', title: 'p', image: null, sources: [vid('aaaaaaaaaaa')], verdict: { ...v, pct: 50 } },
    { asin: 'PUBL000001', title: 'u', image: null, sources: [vid('bbbbbbbbbbb')], verdict: { ...v, pct: 10 } },
  ], new Map([['aaaaaaaaaaa', 'not_public' as const], ['bbbbbbbbbbb', 'public' as const]]))
  check('a public video comes first, then a private one, then storefront only, whatever the discount',
    ranked.map((p) => p.asin).join() === 'PUBL000001,PRIV000001,STORE00001', ranked.map((p) => p.asin).join())
  check('and every video is labelled with what YouTube said, unknown kept as unknown',
    ranked[1].sources[0].visibility === 'not_public'
    && applyVisibility([{ asin: 'X', title: 'x', image: null, sources: [vid('ccccccccccc')], verdict: v }], new Map())[0].sources[0].visibility === null)
  check('the comment route refuses private, unlisted and scheduled videos, in words that say which',
    notPublicMessage('public', null) === null
    && /scheduled/.test(notPublicMessage('private', '2030-01-01T00:00:00Z') || '')
    && /unlisted/.test(notPublicMessage('unlisted', null) || '')
    && /private/.test(notPublicMessage('private', null) || ''))
  const C = read('app/api/on-sale/comment/route.ts')
  check('and it asks YouTube before it posts, not after',
    inOrderCheck(C, 'notPublicMessage(status.privacy', 'yt.postComment('))
  const PR = read('app/api/on-sale/promo/route.ts')
  check('the promo only offers a public video for the comment and the review link',
    /video: leadPublic && lead \?/.test(PR) && /const videoUrl = \(leadPublic \|\| leadVis === 'short'\) &&/.test(PR)
    && /videoNotPublic: lead && leadVis && leadVis !== 'public'/.test(PR))
  const UI = read('components/labs/OnSale.tsx')
  check('the page says why there is no comment button',
    /promo\.videoNotPublic \?/.test(UI) && /no video yet, so there is no video to comment on/.test(UI) && /Private or scheduled/.test(UI))
}

// ── the sale comes out of the comment when the sale ends ────────────────────
async function saleEndedGuards() {
  check('the after-sale version never carries the sale',
    lastingBody('It is on sale right now, grab it!', 'KAKULO Water Bottle, 1L') === 'Here is the link to the KAKULO Water Bottle from this video, if you want to take a closer look.'
    && lastingBody('A great deal today', 'X') !== 'A great deal today'
    && lastingBody('This is the bottle I use on every camping trip.', 'X') === 'This is the bottle I use on every camping trip.')
  check('both versions end with the price line and the disclosure',
    commentWithLink('Hi', 'https://amzn.to/x').endsWith(`${PRICE_LINE_LEAD} https://amzn.to/x\n${DISCLOSURE}`)
    && !SALE_WORDING.test('Check the latest price on Amazon here:'))

  // A fake database: deal cache, Keepa cache, nothing else. No Keepa key, so
  // a product in neither cache cannot be checked at all.
  const fresh = new Date().toISOString()
  const fake = (tables: Record<string, Array<Record<string, unknown>>>) => ({
    from: (t: string) => {
      const rows = tables[t] ?? []
      const q: Record<string, unknown> = {}
      let out = rows
      const chain = new Proxy(q, {
        get: (_o, k: string) => {
          if (k === 'then') return (res: (v: unknown) => void) => res({ data: out, error: null })
          if (k === 'in') return (col: string, vals: string[]) => { out = out.filter((r) => vals.includes(String(r[col]))); return chain }
          return () => chain
        },
      })
      return chain
    },
  })
  const saved = process.env.KEEPA_API_KEY
  delete process.env.KEEPA_API_KEY
  try {
    const db = fake({
      deal_radar_cache: [{ asin: 'DEAL000001', discount_pct: 30, price_now_cents: 700, price_was_cents: 1000, deal_type: 'deal', lightning_ends_at: null, refreshed_at: fresh }],
      keepa_product_cache: [{ asin: 'OVER000001', price_now_cents: 1000, price_avg_cents: 1000, price_lowest_cents: 800, discount_pct: 0, empty: false, fetched_at: fresh }],
    })
    const now = await salesNow(db, ['DEAL000001', 'OVER000001', 'NONE000001'])
    check('a live deal is on, a checked full price is ended, and an unchecked product is unknown, never ended',
      now.get('DEAL000001') === 'on' && now.get('OVER000001') === 'ended' && now.get('NONE000001') === 'unknown',
      JSON.stringify([...now]))
    const stale = await salesNow(fake({
      deal_radar_cache: [{ asin: 'DEAL000001', discount_pct: 30, deal_type: 'deal', refreshed_at: new Date(Date.now() - 30 * 3_600_000).toISOString() }],
    }), ['DEAL000001'])
    check('a day-old deal row does not keep an ended sale alive', stale.get('DEAL000001') !== 'on', String(stale.get('DEAL000001')))
  } finally { if (saved !== undefined) process.env.KEEPA_API_KEY = saved }

  const C = read('app/api/on-sale/comment/route.ts')
  check('no sale comment is posted without its after-sale version',
    inOrderCheck(C, 'The version for after the sale is missing', 'yt.postComment(') && /SALE_WORDING\.test\(lastingBodyPart\)/.test(C))
  check('one sale comment per video per sale',
    inOrderCheck(C, ".eq('state', 'on_sale').limit(1)", 'yt.postComment('))
  check('a posted comment is remembered, and a failure to remember is said',
    inOrderCheck(C, 'yt.postComment(', "from('sale_comments').insert(") && /trackError/.test(C))
  check('twenty sale comments per creator per day, counted before posting and said on the page',
    SALE_COMMENTS_PER_DAY === 20
    && inOrderCheck(C, '>= SALE_COMMENTS_PER_DAY', 'yt.postComment(')
    && /\.gte\('posted_at', since\)/.test(C)
    && /YouTube sale comments left in the last 24 hours/.test(read('components/labs/OnSale.tsx')))
  const CRON = read('app/api/cron/sale-comments/route.ts')
  check('the job leaves an unchecked price alone and only edits an ended sale',
    inOrderCheck(CRON, "if (verdict === 'unknown') { unknown++; continue }", 'takeSaleOut(sb, r)'))
  // Matched the way the covered-sales check is, which passes on Vercel.
  // Vercel's copy of vercel.json is not spaced like the repo's, and a match
  // on '"path": "..."' failed only there. The detail says what it saw.
  {
    const V = read('vercel.json')
    check('the sale comments job is on the schedule', /"\/api\/cron\/sale-comments"/.test(V),
      `vercel.json here is ${V.length} bytes; its cron paths: ${(V.match(/\/api\/cron\/[a-z-]+/g) ?? []).slice(-4).join(', ')}`)
  }
  const M = read('supabase/migrations/374_sale_comments.sql')
  check('migration 374 is twice-runnable',
    /create table if not exists public\.sale_comments/.test(M) && /drop policy if exists "sale_comments_own_read"/.test(M))

  const BG = read('extension/background.js')
  check('SCOUT pins by the comment id and reports the badge, not the click',
    /msg\.type === 'MVP_YT_PIN_COMMENT'/.test(BG)
    && /decodeURIComponent\(m\[1\]\) !== commentId/.test(BG)
    && (BG.match(/seen \? \{ ok: true, pinned: true, steps:/g) ?? []).length === 2
    && (BG.match(/const seen = await until\(anyPinned, \d+\)/g) ?? []).length === 2
    // It reports how far it got, so a failure names its step.
    && /steps: steps\.concat\('confirm box: none'\)|steps\.push\('confirm box: none'\)/.test(BG)
    && !/return \{ ok: true, pinned: true \}/.test(BG)
    // A swapped tab (installed YouTube app, prerender) is found again by the
    // comment's own address, not given up on as "No tab with id".
    && /chrome\.tabs\.onReplaced\.addListener\(onReplaced\)/.test(BG)
    && /u\.indexOf\(`lc=\$\{commentId\}`\) >= 0/.test(BG)
    && /No tab with id\|tab was closed/.test(BG))
  const UI = read('components/labs/OnSale.tsx')
  check('the page says Pinned only when SCOUT saw it, and saves what it saw',
    /const pinned = !!\(r\.ok && r\.pinned\)/.test(UI) && /action: 'pin_result'/.test(UI)
    && /scoutAtLeast\(scout\.version, SCOUT_PIN_MIN_VERSION\)/.test(UI))
}

// ── done already, at a glance ───────────────────────────────────────────────
{
  const SP = read('app/api/deal-radar/social-post/route.ts')
  check('a share from On sale now is recorded from what the platforms answered',
    /out\.results\.filter\(\(r\) => r\.ok\)\.map/.test(SP) && /if \(body\.source === 'on_sale'\)/.test(SP)
    && /if \(!ok\.length && !scheduledFor\) return/.test(SP))
  const UI = read('components/labs/OnSale.tsx')
  check('the page tags products already commented on and shared, and a taken-out comment reads as an earlier sale',
    /<DoneTags comment=\{lastComment\} share=\{lastShare\} \/>/.test(UI) && /Commented in an earlier sale/.test(UI)
    && /source="on_sale" onDone=/.test(UI) && inOrderCheck(UI, "toast.success('Comment posted on your video')", 'if (j.commentId) void pinIt({') && /create table if not exists public\.on_sale_shares/.test(read('supabase/migrations/374_sale_comments.sql')))
}

async function finish() {
await saleEndedGuards()
// ── every video product, every day; the storefront on a rolling allowance ──
{
  const vids = Array.from({ length: 150 }, (_, i) => `V${String(i).padStart(9, '0')}`)
  const store = Array.from({ length: 300 }, (_, i) => `S${String(i).padStart(9, '0')}`)
  const inVideo = new Set(vids)
  const fresh = new Set([store[0], vids[0]])
  const split = pickLookups([...vids, ...store], inVideo, fresh, { cap: 100, videoCap: 500 })
  check('with a video allowance, every video product is looked up and the storefront keeps its own 100',
    vids.every((v) => split.includes(v)) && split.filter((a) => a.startsWith('S')).length === 101 && split.includes(store[0]),
    `${split.filter((a) => a.startsWith('V')).length} videos, ${split.filter((a) => a.startsWith('S')).length} storefront`)
  const shared = pickLookups([...vids, ...store], inVideo, fresh, { cap: 50 })
  check('without one (the page, Amazon Live), everything still shares one allowance, videos first',
    shared.length === 52 && shared.slice(2).every((a) => a.startsWith('V')))
  const CRON = read('app/api/cron/covered-sales/route.ts')
  check('the daily job gives video products their own allowance, and runs four times a day so a skipped creator is picked up the same day',
    /findSales\(sb, covered, \{ keepaCap: 100, videoKeepaCap: VIDEO_DAILY_MAX \}\)/.test(CRON)
    && /const RECHECK_HOURS = 20/.test(CRON) && /\(lastChecked\.get\(u\) as string\) < dueBefore/.test(CRON)
    && /"schedule": "23 \*\/6 \* \* \*"/.test(read('vercel.json').replace(/"schedule":"/g, '"schedule": "')))
  check('the page says what is checked daily and what goes round', /The products in your YouTube videos are checked for a real sale every day/.test(read('components/labs/OnSale.tsx')))
}

// ── Shorts: links in their comments are not clickable ────────────────────
{
  const { shortFromDetails, isoSeconds } = await import('../lib/shorts-detect')
  check('a Short is three minutes or less and square or vertical; anything unknown stays unknown',
    shortFromDetails({ durationIso: 'PT45S', width: 1080, height: 1920 }) === true
    && shortFromDetails({ durationIso: 'PT2M59S', width: 1080, height: 1080 }) === true
    && shortFromDetails({ durationIso: 'PT45S', width: 1920, height: 1080 }) === false
    && shortFromDetails({ durationIso: 'PT3M1S', width: 1080, height: 1920 }) === false
    && shortFromDetails({ durationIso: 'PT45S' }) === null && shortFromDetails({}) === null && isoSeconds('PT1H2M3S') === 3723)
  const D = read('lib/shorts-detect.ts')
  check('a video the API saw without a frame size is not guessed by the public probe', /out\.get\(id\) === null && !seenByApi\.has\(id\)/.test(D))
  const C = read('app/api/on-sale/comment/route.ts')
  check('Encore never posts a sale comment on a Short, and says why',
    inOrderCheck(C, '(await detectShorts([videoId], token)).get(videoId) === true', 'yt.postComment(') && /YouTube does not make links in Shorts comments clickable/.test(C))
  const PR = read('app/api/on-sale/promo/route.ts')
  check('the promo picks a public video that is not a Short for the comment',
    /vis\.get\(v\.youtubeVideoId \|\| ''\) === 'public' && shorts\.get\(v\.youtubeVideoId \|\| ''\) !== true/.test(PR))
  const UI = read('components/labs/OnSale.tsx')
  check('the page labels Shorts and explains the missing comment button', /v\.isShort === true/.test(UI) && /is a Short, and YouTube does not make links in Shorts comments clickable/.test(UI))
  check('the Community post can be copied and opened on the channel in one press',
    /\/community\?show_create_dialog=1/.test(UI) && /Copy and open YouTube/.test(UI) && /communityChannelId,/.test(PR))
  const M = read('app/api/youtube/generate-metadata/route.ts')
  check('Co-Pilot Short mode is gated, points to the full review, and leaves no dead link in the pinned comment',
    /isShort === true && canUsePreview\('shorts_mode', tier\)/.test(M) && /Watch the full review: \$\{fullReviewUrl\}/.test(M)
    && /if \(shortMode && engagementResult\.pinnedComment\)/.test(M) && /shorts\.get\(id\) === false/.test(M))
  const P = read('app/(dashboard)/co-pilot/page.tsx')
  check('the Co-Pilot card only goes Short when YouTube said so', /const shortMode = isShort === true && canUsePreview\('shorts_mode', userTier\)/.test(P) && /\.\.\.\(shortMode \? \{ isShort: true \} : \{\}\)/.test(P))
  check('Short mode is admin only while testing', !canUsePreview('shorts_mode', 'pro') && canUsePreview('shorts_mode', 'admin'))
}

// ── the name: Encore, at /encore, and the old address still lands there ────
check('Encore lives at /encore and /on-sale redirects to it',
  /redirect\('\/encore'\)/.test(read('app/(dashboard)/on-sale/page.tsx'))
  && /title="Encore"/.test(read('components/labs/OnSale.tsx'))
  && /href="\/encore"/.test(read('components/dashboard/PriceAlertsPanel.tsx')))
check('no user-facing "On sale now" is left',
  !['components/labs/OnSale.tsx', 'components/usage/YourUsage.tsx', 'components/co-pilot/ComparisonProducts.tsx', 'app/api/on-sale/route.ts', 'app/api/on-sale/promo/route.ts', 'app/api/on-sale/comment/route.ts']
    .some((f) => /'On sale now|"On sale now|>On sale now|from On sale now|so On sale now/.test(read(f).replace(/^\s*(\/\/|\*).*$/gm, ''))))

if (failures.length) {
  console.error(`\n❌ labs-sales-live: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ labs-sales-live: admin-only previews, a sale rule with a line, a promo with no prices, and a show clock that adds up')
}
void finish()
