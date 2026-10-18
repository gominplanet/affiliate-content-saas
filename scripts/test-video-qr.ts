// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// QR codes burned into the YouTube cut (lib/video-codes, app/v/[code],
// migration 441; docs/qr-on-youtube-plan.md).
//
// The invariant this file exists for: A /v/ CODE CAN NEVER RESOLVE TO AN
// AMAZON URL. Amazon's Operating Agreement section 7(b) bars Associates links
// in connection with Internet-enabled televisions, and a television is the
// whole premise of the feature. If that stops being true, a customer loses
// their Associates account over a video they cannot withdraw.
import { readFileSync, existsSync } from 'node:fs'
import {
  neverAmazon, resolveCode, qrSetupMissing, qrPlacement, qrWindow, validateQrPreset,
  mintCode, videoCodeUrl, declaredShopUrl, CODE_RE, QR_MIN_PX, TRACKING_ID_WARMUP_MS,
} from '../lib/video-codes'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => {
  if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`)
}
const read = (f: string) => readFileSync(f, 'utf8')
const APP = 'https://www.mvpaffiliate.io'

// ── The invariant ────────────────────────────────────────────────────────────
const AMAZON = [
  'https://www.amazon.com/dp/B01234ABCD',
  'https://www.amazon.co.uk/dp/B01234ABCD?tag=seb-21',
  'https://amazon.de/dp/B01234ABCD',
  'https://smile.amazon.com/dp/B01234ABCD',
  'https://amzn.to/3xYzAbc',
  'https://amzn.eu/d/abc123',
  'https://a.co/d/abc123',
  'https://www.mvpl.ink/x7k',
  'https://mvpl.ink/x7k',
  'https://www.mvpaffiliate.io/go/x7k',
  'https://example.com/out?tag=seb-20',
  'https://example.com/out?u=1&ascsubtag=v123',
]
check('every shape of Amazon destination is refused', AMAZON.every((u) => neverAmazon(u)), AMAZON.filter((u) => !neverAmazon(u)))
check('our own Passport hop is refused, because it ends at Amazon with the tag on it', neverAmazon('https://www.mvpaffiliate.io/go/x7k') && neverAmazon('https://www.mvpl.ink/x7k'))
check('nothing, a non URL and a non http scheme are all refused', neverAmazon('') && neverAmazon(null) && neverAmazon('not a url') && neverAmazon('javascript:alert(1)') && neverAmazon('ftp://x/y'))
const GOOD = [`${APP}/shop/seb/B01234ABCD`, `${APP}/shop/seb`, 'https://gominreviews.com/best-wallet/']
check('a creator’s own pages are allowed', GOOD.every((u) => !neverAmazon(u)), GOOD.filter((u) => neverAmazon(u)))

// A poisoned row must not become a poisoned redirect. These are the shapes a
// bug, a bad import or a hostile write would actually produce.
const poisoned = [
  { post_url: 'https://www.amazon.com/dp/B01234ABCD?tag=seb-20', handle: 'seb', asin: 'B01234ABCD' },
  { post_url: 'https://www.mvpl.ink/x7k', handle: 'seb', asin: 'B01234ABCD' },
  { post_url: 'https://amzn.to/3xYzAbc', handle: null, asin: null },
]
check('a stored Amazon post url is ignored, not followed', poisoned.every((row) => {
  const r = resolveCode(row, { appUrl: APP })
  return r === null || !neverAmazon(r.url)
}), poisoned.map((row) => resolveCode(row, { appUrl: APP })))
check('a live post url that is Amazon is ignored too',
  resolveCode({ handle: 'seb', asin: 'B01234ABCD' }, { appUrl: APP, livePostUrl: 'https://www.amazon.com/dp/B01234ABCD' })?.url === `${APP}/shop/seb/B01234ABCD`)

// ── Where a scan goes ────────────────────────────────────────────────────────
check('the creator’s own post wins when there is one',
  resolveCode({ handle: 'seb', asin: 'B01234ABCD' }, { appUrl: APP, livePostUrl: 'https://gominreviews.com/wallet/' })?.via === 'post')
check('a post written after the burn moves a QR already in the wild',
  resolveCode({ handle: 'seb', asin: 'B01234ABCD', post_url: null }, { appUrl: APP, livePostUrl: 'https://gominreviews.com/new/' })?.url === 'https://gominreviews.com/new/')
check('with no post it is the product’s own page, which is real from the first second',
  resolveCode({ handle: 'seb', asin: 'B01234ABCD' }, { appUrl: APP })?.url === `${APP}/shop/seb/B01234ABCD`)
check('with no product it is the shop itself', resolveCode({ handle: 'seb' }, { appUrl: APP })?.via === 'shop')
check('the handle the shop is on NOW beats the one stored at burn time',
  resolveCode({ handle: 'old', asin: 'B01234ABCD' }, { appUrl: APP, liveHandle: 'new' })?.url === `${APP}/shop/new/B01234ABCD`)
// FAIL CLOSED. Nowhere real to land is "no QR", never "send them to Amazon".
check('no handle and no post resolves to nothing at all', resolveCode({ asin: 'B01234ABCD' }, { appUrl: APP }) === null)
check('a switched off code resolves to nothing', resolveCode({ handle: 'seb', asin: 'B01234ABCD', state: 'off' }, { appUrl: APP }) === null)
check('a handle that is not a handle is refused', resolveCode({ handle: '../../etc', asin: 'B01234ABCD' }, { appUrl: APP }) === null
  && resolveCode({ handle: 'a', asin: 'B01234ABCD' }, { appUrl: APP }) === null)
check('a half written asin falls back to the shop rather than a 404 product page',
  resolveCode({ handle: 'seb', asin: 'B012' }, { appUrl: APP })?.url === `${APP}/shop/seb`)

// ── The codes themselves ─────────────────────────────────────────────────────
const codes = new Set(Array.from({ length: 2000 }, () => mintCode()))
check('codes are the shape the route accepts', [...codes].every((c) => CODE_RE.test(c)))
check('two thousand codes are two thousand codes', codes.size === 2000, codes.size)
check('the QR holds a URL on our own origin, under /v/', videoCodeUrl('abc1234', `${APP}/`) === `${APP}/v/abc1234`)

// ── What the creator told Amazon ─────────────────────────────────────────────
// Nothing is displayed on a redirect, so the declared property is the shop
// page, never mvpl.ink and never the resolver.
check('the declared page is the shop page', declaredShopUrl('Seb', APP) === `${APP}/shop/seb`)
check('the declared page is not the resolver and not mvpl.ink',
  !/\/v\//.test(declaredShopUrl('seb', APP)) && !/mvpl\.ink/.test(declaredShopUrl('seb', APP)))
const NOW = Date.parse('2026-10-18T12:00:00Z')
const dayAgo = new Date(NOW - 2 * TRACKING_ID_WARMUP_MS).toISOString()
check('no shop page, no QR', qrSetupMissing({ handle: null, declaredAt: dayAgo, trackingId: 'seb-v-20' }, NOW).length === 1)
check('no declaration, no QR', qrSetupMissing({ handle: 'seb', declaredAt: null, trackingId: 'seb-v-20' }, NOW).length === 1)
check('no tracking ID, no QR', qrSetupMissing({ handle: 'seb', declaredAt: dayAgo, trackingId: '' }, NOW).length === 1)
check('everything done is go', qrSetupMissing({ handle: 'seb', declaredAt: dayAgo, trackingId: 'seb-v-20' }, NOW).length === 0)
// Amazon says a new tracking ID can take 24 hours. Burning before then puts
// dead links in a video that is already public.
const fresh = new Date(NOW - 3_600_000).toISOString()
check('a tracking ID made an hour ago waits for Amazon to switch it on',
  /more hours/.test(qrSetupMissing({ handle: 'seb', declaredAt: fresh, trackingId: 'seb-v-20' }, NOW)[0] || ''))
check('what is missing is said in the creator’s words, not as a code',
  qrSetupMissing({ handle: null, declaredAt: null, trackingId: null }, NOW).every((m) => /\s/.test(m) && !/[_A-Z]{3,}/.test(m)))

// ── The burn ─────────────────────────────────────────────────────────────────
const preset = validateQrPreset({})
check('the default is lower right, where viewers look for it', preset.corner === 'lower-right' && preset.when === 'end')
check('a wild preset is clamped, not trusted', (() => {
  const p = validateQrPreset({ corner: 'middle-of-the-face', widthPct: 40, seconds: 9999, when: 'whenever' })
  return p.corner === 'lower-right' && p.widthPct <= 0.35 && p.seconds <= 20 && p.when === 'end'
})())
// A QR too small to scan is the same as no QR, except that it is in the video
// for ever. The frame wins over the preference.
const tiny = qrPlacement(validateQrPreset({ widthPct: 0.08 }), 1920)
check('a QR too small to scan on a television is made bigger, and says so', tiny.raised && tiny.widthPct * 1920 >= QR_MIN_PX)
const big = qrPlacement(validateQrPreset({ widthPct: 0.3 }), 1920)
check('a QR already big enough is left alone', !big.raised && Math.abs(big.widthPct - 0.3) < 1e-9)
for (const corner of ['lower-right', 'lower-left', 'upper-right', 'upper-left'] as const) {
  const p = qrPlacement(validateQrPreset({ corner, widthPct: 0.2 }), 1920)
  check(`${corner} stays inside the frame`, p.xPct >= 0 && p.yPct >= 0 && p.xPct + p.widthPct <= 1 && p.yPct <= 1)
}
const w = qrWindow(validateQrPreset({ seconds: 12 }), 600)
check('an end card rides the last seconds', w.endSec === 600 && Math.abs(w.startSec - 588) < 1e-9)
check('it never runs past a short video', (() => { const s = qrWindow(validateQrPreset({ seconds: 20 }), 20); return s.endSec <= 20 && s.startSec >= 0 })())
check('early sits after the opening', qrWindow(validateQrPreset({ when: 'early' }), 600).startSec === 5)

// ── The route ────────────────────────────────────────────────────────────────
const route = read('app/v/[code]/route.ts')
check('the resolver exists and is public', existsSync('app/v/[code]/route.ts') && /'\/v',/.test(read('middleware.ts')))
// Not one exit from this file may be an Amazon URL, including the fallbacks
// /go/[code] uses (it redirects to amazon.com when a code is unknown).
check('the resolver names no Amazon host anywhere, not even as a fallback', !/amazon\.|amzn\.|a\.co|mvpl\.ink/i.test(route.replace(/^\s*\/\/.*$/gm, '')))
check('the resolver asks the invariant again on the way out', /neverAmazon\(dest\.url\)/.test(route))
check('an unknown code goes to MVP, never to a store', /if \(!row\) return NextResponse\.redirect\(APP_HOME/.test(route))
// A churned creator's videos run for ever with our code burned in.
check('the resolver reads no tier and no subscription', !/tier|subscription|canUse|stripe/i.test(route.replace(/^\s*\/\/.*$/gm, '')))
check('the scan is logged after the redirect, never in front of it', /after\(async/.test(route) && route.indexOf('after(async') < route.indexOf('return NextResponse.redirect(dest.url'))

// ── The migration ────────────────────────────────────────────────────────────
const sql = read('supabase/migrations/441_video_qr_codes.sql')
check('migration 441 makes the codes and their scans, safe to run twice',
  /create table if not exists public\.video_codes/.test(sql) && /create table if not exists public\.video_code_scans/.test(sql)
  && /add column if not exists qr jsonb/.test(sql) && /add column if not exists qr_chosen/.test(sql)
  && /add column if not exists qr_code text/.test(sql) && /add column if not exists qr_shop_declared_at/.test(sql))
check('nothing in the migration drops a table or deletes a row', !/drop table|delete from|truncate/i.test(sql))
// A churned creator's codes are never cleaned up, so nothing may cascade a
// code away when a subscription ends.
check('a code outlives the row it was burned from', /launch_item_id uuid references public\.launch_items\(id\) on delete set null/.test(sql))

if (fails.length) {
  console.error(`\n❌ video-qr: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ video-qr: a QR on a television resolves to the creator’s own page, never to Amazon, and keeps resolving after they stop paying')
