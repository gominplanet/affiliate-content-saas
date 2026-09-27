// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// After the deal (lib/deal-aftercare.ts, plugin 1.0.97).
//
// A deal post kept selling a sale that was over: "Save about 27%", "Active
// deal · save while it lasts", and a button the countdown disabled, so the
// reader had nowhere to click. What must hold: an ended deal is shown as ended
// with a working button; a post is only rewritten when its deal really ended;
// a rewrite that lost a link or a box is never published; and the title and
// intro that replace the sale ones stay true.
import { readFileSync } from 'node:fs'
import { parseDealEnd, dealState, lastingTitle, lastingExcerpt, markShortcodesEnded, rewriteIsSafe, dealPhase, reviveShortcodes, saleAgainExcerpt, firstProductHref } from '../lib/deal-aftercare'
import { canUsePreview } from '../lib/labs-preview'
import { WP_VERSIONS } from '../lib/wp-versions'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrder = (src: string, a: string, b: string) => { const i = src.indexOf(a); const j = src.indexOf(b, i + 1); return i >= 0 && j > i }

// ── when a deal ended ───────────────────────────────────────────────────────
check('an ISO end date is read', parseDealEnd('2026-07-08', null)?.toISOString().slice(0, 10) === '2026-07-08')
check('"Jul 16" takes the year the post went up, and lasts the whole day',
  parseDealEnd('Jul 16', '2026-06-05T10:00:00Z')?.toISOString() === '2026-07-16T23:59:59.000Z')
check('a date that would fall before the post is next year\'s', parseDealEnd('Jan 3', '2026-12-20T00:00:00Z')?.toISOString().slice(0, 10) === '2027-01-03')
check('text that is not a date is no date', parseDealEnd('soon', '2026-06-05') === null && parseDealEnd('', null) === null)
const now = Date.parse('2026-09-27T12:00:00Z')
check('a passed end date means ended', dealState({ endAt: new Date('2026-07-08'), now }).state === 'ended')
check('a future end date means on', dealState({ endAt: new Date('2026-12-01'), now }).state === 'on')
check('no date and no price check is unknown, never ended', dealState({ endAt: null, now }).state === 'unknown')
check('a price check that found no sale means ended; one that found a sale means on',
  dealState({ endAt: null, now, priceCheck: 'ended' }).state === 'ended' && dealState({ endAt: null, now, priceCheck: 'on' }).state === 'on')

// ── the lasting title and intro ─────────────────────────────────────────────
check('"Deal Alert:" comes off and it becomes a review', lastingTitle('Deal Alert: LEVOIT Tower Fan for Bedroom', 'LEVOIT Tower Fan') === 'LEVOIT Tower Fan for Bedroom Review',
  lastingTitle('Deal Alert: LEVOIT Tower Fan for Bedroom', 'LEVOIT Tower Fan'))
check('"Save 27%" and "% off" come off', !/save|%|off\b/i.test(lastingTitle('LEVOIT Tower Fan: Save 27% Today, 27% Off', 'LEVOIT Tower Fan')),
  lastingTitle('LEVOIT Tower Fan: Save 27% Today, 27% Off', 'LEVOIT Tower Fan'))
check('a title already about the product is kept', lastingTitle('LEVOIT Oscillating Standing Fan Review', 'x') === 'LEVOIT Oscillating Standing Fan Review')
check('an occasion deal title loses the occasion', lastingTitle('Prime Day Deal: Ninja Crispi Air Fryer', 'Ninja') === 'Ninja Crispi Air Fryer Review')
const ex = lastingExcerpt('LEVOIT Tower Fan for Bedroom, 90° Oscillating')
check('the intro names the product and makes no sale claim, year or dash',
  /LEVOIT Tower Fan for Bedroom/.test(ex) && !/save|% off|limited|deal/i.test(ex) && !/\b20\d\d\b/.test(ex) && !/[–—]/.test(ex))

// ── the deal boxes ──────────────────────────────────────────────────────────
const body = '<p>x</p>[mvp_deal_banner end_date="" badge="27% OFF" url="https://amazon.com/dp/X"]<p>y</p>[mvp_deal_cta url="https://amazon.com/dp/X"]'
const m1 = markShortcodesEnded(body), m2 = markShortcodesEnded(m1.html)
check('both boxes are marked ended, once', m1.changed && (m1.html.match(/ended="1"/g) || []).length === 2 && !m2.changed && m2.html === m1.html)

// ── a rewrite is published only when it kept everything ────────────────────
const before = '<p>Save 27% now! <a href="https://amazon.com/dp/X">See the deal on Amazon</a></p>[mvp_deal_banner ended="1"]<p>More text here about the fan and its speeds.</p>'
check('a faithful rewrite passes', rewriteIsSafe(before, before.replace('Save 27% now!', 'A quiet fan.').replace('See the deal', 'Check the price')).ok)
check('a rewrite that lost a link is refused', !rewriteIsSafe(before, before.replace(/<a [^>]+>([^<]+)<\/a>/, '$1')).ok)
check('a rewrite that lost a deal box is refused', !rewriteIsSafe(before, before.replace('[mvp_deal_banner ended="1"]', '')).ok)
check('a rewrite that came back short is refused', !rewriteIsSafe(before, '<p>short</p>').ok)

// ── the plugin ──────────────────────────────────────────────────────────────
const PHP = read('wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php')
check('the plugin decides ended on the server, from the date or the ended flag',
  /\$ended = in_array\(strtolower\(trim\(\(string\) \$atts\['ended'\]\)\)/.test(PHP) && /\(\$end_iso !== '' && strtotime\(\$end_iso\) <= time\(\)\)/.test(PHP))
check('an ended box says so and keeps a working button', /This deal has ended<\/div>/.test(PHP) && /Check today&apos;s price →/.test(PHP))
check('the countdown no longer disables the button', !/cta\.style\.pointerEvents = 'none'/.test(PHP) && /heading\.textContent = 'This deal has ended'/.test(PHP))
check('the closing block reads the end date from the same post\'s deal box', /preg_match\('\/\\\[mvp_deal_banner/.test(PHP) && /Still thinking about it\?/.test(PHP))
check('the plugin version is advertised', /Version: 1\.0\.97/.test(PHP) && WP_VERSIONS.plugin.version === '1.0.97')

// ── the conversion ──────────────────────────────────────────────────────────
const SRV = read('lib/deal-aftercare-server.ts')
check('a post whose deal did not end is not rewritten', /if \(row\.state !== 'ended' && !opts\.force\) return \{ ok: false/.test(SRV))
check('the article is replaced only when the rewrite kept every link and box',
  inOrder(SRV, 'const safe = rewriteIsSafe(html, out)', "if (safe.ok) { html = out; article = 'rewritten' }"))
check('the change is recorded only after WordPress took it', inOrder(SRV, 'await wp.updatePost(', 'endedAt: at, aftercare: report'))
check('the price check spends a capped number of Keepa lookups', /const batch = need\.slice\(0, cap\)/.test(SRV) && /cap = CHECK_MAX\)/.test(SRV))
check('the address never changes', !/slug\s*:/.test(SRV))
check('Ended deals is admin only while it is tested', !canUsePreview('deal_aftercare', 'pro') && canUsePreview('deal_aftercare', 'admin'))

// ── back on sale, and ended again ───────────────────────────────────────────
check('a post moves deal, lasting, revived, lasting by its timestamps',
  dealPhase({}) === 'deal' && dealPhase({ endedAt: '2026-08-01' }) === 'lasting'
  && dealPhase({ endedAt: '2026-08-01', revivedAt: '2026-09-01' }) === 'revived' && dealPhase({ endedAt: '2026-09-10', revivedAt: '2026-09-01' }) === 'lasting')
const endedBody = '[mvp_deal_banner end_date="2026-07-08" badge="27% OFF" url="https://amazon.com/dp/X" ended="1"]<p>x</p>[mvp_deal_cta url="https://amazon.com/dp/X" ended="1"]'
const back = reviveShortcodes(endedBody, { pct: 31.6, endsAt: null })
check('bringing it back drops the ended flag and the OLD end date, and shows the new discount',
  back.changed && !/ended=/.test(back.html) && !/2026-07-08/.test(back.html) && (back.html.match(/badge="32% OFF"/g) || []).length === 2, back.html)
const light = reviveShortcodes(endedBody, { pct: null, endsAt: '2026-10-01T18:00:00Z' })
check('a lightning deal counts down on the box, with a plain DEAL chip when the discount is not known',
  /\[mvp_deal_banner[^\]]*end_date="2026-10-01T18:00:00Z"/.test(light.html) && !/\[mvp_deal_cta[^\]]*end_date/.test(light.html) && /badge="DEAL"/.test(light.html))
check('and when that sale ends the boxes go back to ended', (markShortcodesEnded(back.html).html.match(/ended="1"/g) || []).length === 2)
const again = saleAgainExcerpt(31.6, 'LEVOIT Tower Fan')
check('the on-sale-again intro gives the discount and stays free of dashes and a year', /^On sale again: about 32% off right now\./.test(again) && !/[\u2013\u2014]/.test(again) && !/\b20\d\d\b/.test(again))
check('a post with no deal box gets one pointing at its own product link', firstProductHref('<a href="https://www.amazon.com/dp/X?tag=t">x</a>') === 'https://www.amazon.com/dp/X?tag=t' && firstProductHref('<a href="https://blog.example/x">x</a>') === null)

const SRV2 = read('lib/deal-aftercare-server.ts')
check('a brought-back deal runs on its NEW end date, never the old one that would end it again',
  /phase === 'revived'\s*\?\s*parseDealEnd\(m\.revivedEndsAt/.test(SRV2))
check('a price check made before the post last changed is not an answer', /checkedAt >= since/.test(SRV2))
check('a lasting review is never "ended" into another rewrite, only brought back on a fresh sale',
  /if \(row\.phase === 'lasting'\) return \{ ok: false, error: 'Not changed: it is already a lasting review\.' \}/.test(SRV2)
  && /if \(row\.state !== 'on'\) return \{ ok: false/.test(SRV2))
check('ending again does not rewrite the article a second time', /if \(articleAlreadyLasting\) \{ article = 'already' \} else try \{/.test(SRV2))
check('bringing it back leaves the title and the article alone', (() => {
  const i = SRV2.indexOf('export async function reviveDealPost'); const body = SRV2.slice(i)
  return i > 0 && !/title:/.test(body.slice(0, body.indexOf('return { ok: true, report }'))) && !/messages\.create/.test(body)
})())
const CRON = read('app/api/cron/deal-aftercare/route.ts')
check('the job runs for those who can use it and have it on, within caps and a deadline',
  /TIERS\.filter\(\(t\) => canUsePreview\('deal_aftercare', t\)\)/.test(CRON) && /\.eq\('deal_aftercare_auto', true\)/.test(CRON)
  && /const CHECKS_PER_RUN = 150/.test(CRON) && /if \(Date\.now\(\) > deadline\) break/.test(CRON))
check('the job is scheduled', /"\/api\/cron\/deal-aftercare"/.test(read('vercel.json')))
check('the switch has its migration, and it defaults to on', /add column if not exists deal_aftercare_auto boolean not null default true/.test(read('supabase/migrations/380_deal_aftercare_auto.sql')))

console.log(failures.length ? `FAIL (${failures.length})` : '✅ deal-aftercare: an ended deal shows as ended with a live button, and only a truly ended post is rewritten, safely')
for (const f of failures) console.log(`   • ${f}`)
process.exit(failures.length ? 1 : 0)
