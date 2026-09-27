// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand recap (lib/brand-content.ts): one message per Creator Connections
// brand with every link made for its products.
//
// What must hold: only the creator's own public content is offered (never an
// affiliate redirect, the product's own listing, a platform's home page, or a
// private video); a post about two products is sent once; "new" means not in a
// recap that actually reached the brand; and the page never says sent unless
// Amazon confirmed it or the creator said so.
import { readFileSync } from 'node:fs'
import {
  shareableUrl, contentPlatform, groupByBrand, buildBrandRecapMessage, buildBrandRecapCcMessage, ccFromPlainText,
  ccGroupCount, linkKey, CC_GROUP_MAX_CHARS, type ContentLink,
} from '../lib/brand-content'
import { CC_GROUP_BREAK } from '../lib/brand-recap'
import { canUsePreview } from '../lib/labs-preview'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrder = (src: string, a: string, b: string) => { const i = src.indexOf(a); const j = src.indexOf(b, i + 1); return i >= 0 && j > i }

// ── which links count ───────────────────────────────────────────────────────
check('real posts are kept, with a trailing slash dropped',
  shareableUrl('https://www.youtube.com/watch?v=abcdefghijk') === 'https://www.youtube.com/watch?v=abcdefghijk'
  && shareableUrl('https://www.pinterest.com/pin/123/') === 'https://www.pinterest.com/pin/123')
check('affiliate redirects, the product listing and a platform home page are not content',
  shareableUrl('https://www.mvpl.ink/x7kQ2') === null && shareableUrl('https://geni.us/abc') === null
  && shareableUrl('https://www.amazon.com/dp/B0DKPK28KW?tag=x-20') === null && shareableUrl('https://www.instagram.com/') === null
  && shareableUrl('not a url') === null)
check('an Amazon video page is content', shareableUrl('https://www.amazon.com/vdp/abc123') === 'https://www.amazon.com/vdp/abc123')
check('platform names from the post routes are read, and a Story is not a post',
  contentPlatform('twitter') === 'x' && contentPlatform('FB') === 'facebook' && contentPlatform('threads') === 'threads' && contentPlatform('instagram_story') === null)

// ── grouping by brand ───────────────────────────────────────────────────────
const L = (asin: string, platform: ContentLink['platform'], url: string, at = '2026-09-01'): ContentLink => ({ asin, platform, url, at })
const links: ContentLink[] = [
  L('B000000001', 'youtube', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', '2026-09-10'),
  L('B000000002', 'youtube', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', '2026-09-10'), // comparison: same video, second product
  L('B000000001', 'x', 'https://x.com/i/web/status/1'),
  L('B000000002', 'blog', 'https://blog.example/review-2/'),
  L('B000000003', 'blog', 'https://blog.example/other-brand'),
  L('B000000009', 'blog', 'https://blog.example/no-cc-brand'),
  L('B000000001', 'facebook', 'https://www.mvpl.ink/abcd'),
]
const brandOf = new Map([
  ['B000000001', { brand: 'Zaperly Inc', campaignIds: ['c1'] }],
  ['B000000002', { brand: 'ZAPERLY', campaignIds: ['c2'] }],
  ['B000000003', { brand: 'Sanar Naturals', campaignIds: [] }],
])
const sent = new Map([['zaperly', new Set([linkKey('https://x.com/i/web/status/1')])]])
const groups = groupByBrand({ links, brandOf, names: new Map([['B000000001', 'Fly Trap']]), sent, lastRecapAt: new Map([['zaperly', '2026-09-05']]) })
const z = groups.find((g) => g.brandKey === 'zaperly')
check('products of one brand under different spellings are one brand, with every campaign kept',
  !!z && z.products.length === 2 && z.campaignIds.join(',') === 'c1,c2', JSON.stringify(z?.campaignIds))
check('a comparison video about two of the brand\'s products is sent once',
  !!z && z.products.flatMap((p) => p.links).filter((l) => l.platform === 'youtube').length === 1)
check('a product with no Creator Connections brand is not offered', !groups.some((g) => g.products.some((p) => p.asin === 'B000000009')))
check('an affiliate redirect never becomes a link', !groups.some((g) => g.products.some((p) => p.links.some((l) => /mvpl\.ink/.test(l.url)))))
check('a link already in a recap is marked sent and not counted new',
  !!z && z.linkCount === 3 && z.newCount === 2 && z.products.flatMap((p) => p.links).some((l) => l.platform === 'x' && l.sent === true))
check('a brand with something new comes first', groups[0]?.newCount > 0)

// ── the message ─────────────────────────────────────────────────────────────
const products = [
  { name: 'Fly Trap', links: [{ platform: 'youtube' as const, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }, { platform: 'x' as const, url: 'https://x.com/i/web/status/1' }] },
  { name: 'Refill pack', links: [{ platform: 'blog' as const, url: 'https://blog.example/review-2' }] },
]
const msg = buildBrandRecapMessage({ brand: 'Zaperly', products, sinceLast: false, name: 'Seb', site: 'https://blog.example' })
check('the message names the brand and carries every ticked link, labelled',
  /^Hi Zaperly team,/.test(msg) && msg.includes('• YouTube: https://www.youtube.com/watch?v=aaaaaaaaaaa') && msg.includes('• Written review: https://blog.example/review-2')
  && /2 of your products/.test(msg))
check('a recap of only new links says so', /since my last update/.test(buildBrandRecapMessage({ brand: 'Z', products, sinceLast: true, name: '', site: '' })))
check('no dashes or year in the copy', !/[–—]| - /.test(msg.replace(/https?:\/\/\S+/g, '')) && !/\b20\d\d\b/.test(msg.replace(/https?:\/\/\S+/g, '')))
const many = Array.from({ length: 12 }, (_, i) => ({ name: `Product ${i}`, links: Array.from({ length: 5 }, (_, k) => ({ platform: 'x' as const, url: `https://x.com/i/web/status/${i}${k}000000000000000` })) }))
const cc = buildBrandRecapCcMessage({ brand: 'Zaperly', products: many, sinceLast: false, name: 'Seb', site: '' })
const parts = cc.split(CC_GROUP_BREAK).map((s) => s.trim())
check('a long Creator Connections recap is split at products, each part under the limit, nothing lost',
  parts.length > 3 && parts.every((p) => p.length <= CC_GROUP_MAX_CHARS) && many.every((p) => p.links.every((l) => cc.includes(l.url))) && /^Hi Zaperly team,/.test(parts[0]))
const edited = ccFromPlainText('Hi Z team,\n\nOpening line.\n\nLinks here\n• X: https://x.com/1\n\nThanks,\nSeb')
check('an edited message keeps the greeting with its first line and packs the rest', ccGroupCount(edited) === 2 && edited.startsWith('Hi Z team,\n\nOpening line.'))

// ── the reads and the send ─────────────────────────────────────────────────
const SRV = read('lib/brand-content-server.ts')
check('a private or scheduled video is left out and counted', /if \(seen === 'not_public'\) \{ privateVideos\+\+; continue \}/.test(SRV))
check('only a recap that reached the brand counts its links as sent', /from\('brand_recaps'\)\.select\('brand_key, urls, created_at, ok'\)\.eq\('user_id', ownerId\)\.eq\('ok', true\)/.test(SRV))
check('reads that fail are named, not silent', /unread\.push\('your YouTube videos'\)/.test(SRV) && /unread\.push\('the Creator Connections catalog'\)/.test(SRV))
const UI = read('components/brand-recap/BrandRecap.tsx')
check('sent is recorded only after Amazon confirmed it',
  inOrder(UI, 'if (byAsin.ok) {', "await log('cc', true") && !/log\('cc', true[^)]*\)[^\n]*\n\s*if \(byAsin\.error/.test(UI))
check('a partial send stops, instead of trying another path that would send the same parts twice',
  inOrder(UI, 'if ((byAsin.groups || 0) > 0) {', 'const direct = await requestSendByCampaign('))
check('a copied or emailed recap counts only when the creator says it was sent', /I sent it/.test(UI) && inOrder(UI, 'async function markSent()', 'await log(ch, true)'))
check('an unconfirmed send in a visible tab is not recorded as sent', inOrder(UI, 'if (direct.leftOpen) {', "setPendingManual('copy')") && !/leftOpen[\s\S]{0,400}log\('cc', true/.test(UI))

// ── links kept from now on ─────────────────────────────────────────────────
check('Deal Radar and Encore posts keep their links', inOrder(read('lib/deal-quick-post.ts'), "await recordProductPostLinks(userId, asin, results, 'deal_post')", 'destinationKind: destination.kind'))
for (const [f, p] of [['fb', 'facebook'], ['ig', 'instagram'], ['pin', 'pinterest']] as const) {
  check(`the Amazon ${p} push keeps its link`, new RegExp(`recordProductPostLinks\\(user\\.id, body\\.asin, \\[\\{ platform: '${p}'`).test(read(`app/api/amazon/${f}/route.ts`)))
}
check('Brand recap is admin only while it is tested', !canUsePreview('brand_recap', 'pro') && canUsePreview('brand_recap', 'admin'))
check('the page and the routes use the same gate',
  /canUsePreview\('brand_recap'/.test(read('app/api/brand-recap/route.ts')) && /canUsePreview\('brand_recap'/.test(read('app/api/brand-recap/log/route.ts'))
  && /canUsePreview\('brand_recap', tier\)/.test(read('app/(dashboard)/brand-recap/page.tsx')))

console.log(failures.length ? `FAIL (${failures.length})` : '✅ brand-recap: only real public links, grouped by brand, new since the last recap, and sent means sent')
for (const f of failures) console.log(`   • ${f}`)
process.exit(failures.length ? 1 : 0)
