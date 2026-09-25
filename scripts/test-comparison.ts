// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guards for comparison videos (Co-Pilot, Labs): one video, 2 to 4 products.
//
// The failure that matters most is a comparison that quietly became one
// product: a description with one link, titles about one brand, or a
// thumbnail showing two of three products, all looking finished. So each
// place a product could drop out has to either keep it or say so.

import { readFileSync } from 'node:fs'
import { readComparisonSlots, productLinksInText, comparisonLinkLines, COMPARISON_MAX } from '../lib/comparison-products'
import { multiProductLine, comparisonLayout, productLine } from '../lib/thumbnail-prompt'
import { canUsePreview } from '../lib/labs-preview'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrder = (src: string, a: string, b: string) => { const i = src.indexOf(a), j = src.indexOf(b); return i > -1 && j > -1 && i < j }

// ── the product list ────────────────────────────────────────────────────────
{
  const ok = readComparisonSlots([{ input: 'B0DDDD8WD6' }, { input: 'https://www.amazon.com/dp/B0CCCC1234?tag=x', label: 'Budget pick' }, { input: '' }])
  check('an ASIN and an Amazon link make a comparison, blanks are ignored', !ok.error && ok.slots.length === 2 && ok.slots[1].asin === 'B0CCCC1234' && ok.slots[1].label === 'Budget pick')
  check('the same product twice is one product, so it is not a comparison', !!readComparisonSlots([{ input: 'B0DDDD8WD6' }, { input: 'b0dddd8wd6' }]).error)
  check('a word that is not an ASIN or a link is refused by name', /not an ASIN or a link/.test(readComparisonSlots([{ input: 'blender' }, { input: 'B0DDDD8WD6' }]).error || ''))
  check('more than four is refused', !!readComparisonSlots(['B0AAAAAAA1', 'B0AAAAAAA2', 'B0AAAAAAA3', 'B0AAAAAAA4', 'B0AAAAAAA5'].map((input) => ({ input }))).error && COMPARISON_MAX === 4)
  check('a short link is kept for the server to follow', readComparisonSlots([{ input: 'https://geni.us/abc' }, { input: 'B0DDDD8WD6' }]).slots[0]?.url === 'https://geni.us/abc')
  const found = productLinksInText('Get it https://www.amazon.com/dp/B0DDDD8WD6?tag=a and https://geni.us/abc')
  check('the slots fill from product links in the description', found[0] === 'B0DDDD8WD6' && found[1] === 'https://geni.us/abc', JSON.stringify(found))
  check('one description line per product, named, with its own link',
    comparisonLinkLines([{ name: 'Ninja AF101', label: 'Budget pick', link: 'https://a' }, { name: 'Cosori', link: 'https://b' }]).join('|') === '1. Budget pick: Ninja AF101: https://a|2. Cosori: https://b')
}

// ── the thumbnail prompt ────────────────────────────────────────────────────
{
  const three = multiProductLine({ firstImage: 3, count: 3, comparison: true })
  check('a comparison shows every product, from its own image, as equals',
    /Images 3 to 5 are 3 DIFFERENT products/.test(three) && /EVERY one/.test(three) && /as equals/.test(three) && /three across/.test(three))
  check('each count has its own layout', /VS/.test(comparisonLayout(2)) && /three across/.test(comparisonLayout(3)) && /2 by 2 grid/.test(comparisonLayout(4)))
  check('the creator\'s arrangement note wins over the default layout',
    /as the creator asked: "phone left, case right"/.test(multiProductLine({ firstImage: 1, count: 2, comparison: true, arrangement: 'phone left, case right' })))
  const base = { creatorRefLabel: 'Image 1', identityInstruction: '', productLabel: 'x', productRefNum: 2 } as Parameters<typeof productLine>[0]
  check('the default design uses the multi-product paragraph when there are several photos',
    /DIFFERENT products/.test(productLine({ ...base, productRefCount: 2, comparison: true })) && /as the hero/.test(productLine({ ...base, productRefCount: 1 })))
}

// ── Labs ────────────────────────────────────────────────────────────────────
check('comparison videos are admin only while testing', canUsePreview('comparison', 'admin') && !canUsePreview('comparison', 'pro'))

// ── the metadata route ──────────────────────────────────────────────────────
{
  const M = read('app/api/youtube/generate-metadata/route.ts')
  check('the comparison is gated on the preview', /comparisonProducts\.length > 0 && canUsePreview\('comparison', tier\)/.test(M))
  check('every product is resolved before anything is generated, or nothing is',
    /Paste that product's ASIN or its amazon\.com link instead\. Nothing was generated\./.test(M)
    && inOrder(M, "canUsePreview('comparison', tier)", 'discoverProductForVideo('))
  check('the one-product mismatch check does not fire on a comparison title', /&& !comparison\s*\n\s*&& productDiscoverySource === 'caller'/.test(M))
  check('the description has one link per product, and the ASIN line lists them all',
    /\.\.\.comparisonLinkLines\(comparison\.map/.test(M) && /Product ASINs: \$\{comparison\.map\(\(c\) => c\.asin\)\.join\(', '\)\}/.test(M))
  check('each extra product gets the same link style the first one got, and says when it could not',
    /if \(passportUsed\) \{/.test(M) && /if \(geniuslinkUsed\) \{/.test(M) && /if \(bitlyUsed && ytStyle\.bitlyToken\)/.test(M) && /linkNote: l\.note/.test(M))
  check('the titles and the description are written as a comparison with no invented winner',
    /COMPARISON VIDEO: this video compares/.test(M) && /NEVER say one is the winner/.test(M) && /This video COMPARES/.test(M))
  check('the product list is saved in its own write, and a missing column is reported, not fatal',
    /\.update\(\{ asins: comparison\.map\(\(c\) => c\.asin\) \}\)/.test(M) && /'42703' \? 'missing_column'/.test(M) && /comparisonSaved,/.test(M))
  check('the pinned comment carries every product\'s link', /const missing = comparison\.filter\(\(c\) => c\.link && !engagementResult\.pinnedComment\.includes\(c\.link\)\)/.test(M))
}

// ── the thumbnail route ─────────────────────────────────────────────────────
{
  const T = read('app/api/youtube/generate-thumbnail/route.ts')
  check('comparison photos are gated on the preview and never override the creator\'s own uploads',
    /canUsePreview\('comparison', tier\)/.test(T) && /if \(isComparison && customProductRefs\.length === 0\)/.test(T))
  check('every product photo reaches the model, in both render paths',
    /productPngsP\.map\(\(b, i\) => \(\{ data: b/.test(T) && /productPngs\.forEach\(\(b, i\) => refs\.push/.test(T)
    && !/refs\.push\(\{ data: productBytes, filename: 'product\.png'/.test(T)
    && /productRefCount: productPngs\.length/.test(T))
  check('the arrangement note is finally used', (T.match(/arrangement: compositionNote/g) ?? []).length === 2 && /productArrangement: compositionNote/.test(T))
  check('the answer says how many products made it in', (T.match(/comparison: isComparison \? \{ asked: comparisonAsked, shown:/g) ?? []).length === 2)
  check('the art director frames a comparison with no winner and no prices', /COMPARISON \(hard rule\)/.test(T) && /NEVER names a winner/.test(T) && /No prices, dollar amounts or percentages/.test(T))
}

// ── the page ────────────────────────────────────────────────────────────────
{
  const P = read('app/(dashboard)/co-pilot/page.tsx')
  check('the switch only shows for the preview', /\{canCompare && \(\s*<ComparisonProducts/.test(P))
  check('an incomplete comparison is said before anything is spent', inOrder(P, 'if (cmpErr) { toast.error(cmpErr); return }', 'setGenerating(true)'))
  check('a comparison the server did not apply is said', /The comparison was not applied: this metadata covers one product/.test(P))
  check('a thumbnail that lost a product is said', /Only \$\{cmp\.shown\} of the \$\{cmp\.asked\} products are in this thumbnail/.test(P))
}

// ── downstream ──────────────────────────────────────────────────────────────
{
  const C = read('lib/covered-sales.ts')
  check('On sale now covers every product in a comparison video, and works before migration 375',
    /let vres = await readVideos\(true\)\s*\n\s*if \(vres\.error\) vres = await readVideos\(false\)/.test(C) && /Array\.isArray\(v\.asins\)/.test(C))
  check('migration 375 is twice-runnable', /add column if not exists asins text\[\]/.test(read('supabase/migrations/375_video_comparison_asins.sql')))
}

if (failures.length) {
  console.error(`\n❌ comparison: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ comparison: every product resolved, linked, drawn and watched, or the page says which one was not')
