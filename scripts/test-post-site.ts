// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Writes land on the post MVP means (lib/post-site), titles name the product
// (lib/title-product), and wrong live titles can be found (title-audit/live).
// Reported 28 Sep: a Beard Club trimmer review on one blog carried a Beatbot
// pool robot title, written to the same post number on the wrong site.
import { readFileSync } from 'node:fs'
import { samePost, slugOfUrl, titleFitsSlug, sameTitle } from '../lib/post-site'
import { titleNamesProduct, plainProductTitle } from '../lib/title-product'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }

const BEARD = 'https://gominreviews.com/beard-club-pro-trimmer-review-2/'
check('the slug is read from the address', slugOfUrl(BEARD) === 'beard-club-pro-trimmer-review-2' && slugOfUrl('https://x.com/?p=12') === null)
check('the same post passes', samePost(BEARD, { slug: 'beard-club-pro-trimmer-review-2', link: BEARD }))
check('a different post with the same number fails', !samePost(BEARD, { slug: 'beatbot-aquasense-review', link: 'https://other.com/beatbot-aquasense-review/' }))
check('a draft address (?p=) cannot be compared and is not refused', samePost('https://x.com/?p=12', { slug: 'anything', link: '' }))

const beatbot = 'Turn Off Pool Pump With Beatbot (Why It Matters)'
const beard = 'Beard Club Pro Trimmer Review: Clean Lines, Thick Hair'
check('the address tells which title belongs', titleFitsSlug(beard, 'beard-club-pro-trimmer-review-2') > 0.5 && titleFitsSlug(beatbot, 'beard-club-pro-trimmer-review-2') === 0)
check('titles are compared as a reader sees them', sameTitle('It&#8217;s &amp; Co', "It's & co") && !sameTitle(beard, beatbot))

const product = { brand: 'Beard Club', canonical: 'Beard Club Pro Cordless Hair Trimmer' }
check('a title for another product fails the product check', !titleNamesProduct(beatbot, product).ok)
check('a title naming the product passes', titleNamesProduct(beard, product).ok && titleNamesProduct('Beatbot AquaSense 2 Pro: Walls?', { brand: 'Beatbot AquaSense', canonical: 'Beatbot AquaSense 2 Pro Robotic Pool Cleaner' }).ok)
check('with no product known, the check says it did not check', titleNamesProduct('x', null).checked === false)
check('the fallback title is the product name', plainProductTitle(product.canonical) === 'Beard Club Pro Cordless Hair Trimmer Review')

for (const f of ['app/api/tools/title-audit/apply/route.ts', 'app/api/seo/edit-title/route.ts', 'app/api/blog/edit/route.ts', 'app/api/blog/content/route.ts', 'app/api/blog/publish-now/route.ts', 'app/api/blog/refresh/route.ts', 'app/api/tools/title-audit/live/route.ts']) {
  const src = read(f)
  check(`${f} finds the site by the post's address and confirms the post before writing`, /credsForPost\(/.test(src) && /checkSamePost\(/.test(src) && src.indexOf('checkSamePost(') < src.lastIndexOf('updatePost('))
}
const F = read('app/api/seo/fix-all/route.ts')
check('SEO fix-all skips a post filed under another site', /hostOf\(url\) !== hostOf\(ctx\.wpBase\)\) continue/.test(F))
const G = read('app/api/blog/generate/route.ts')
check('a rebuild confirms the post on file before overwriting it', /const same = await checkSamePost\(wpService, existingWpPostId, existingForLimit\.wordpress_url/.test(G))
check('the title is checked against the product before publishing', G.indexOf('titleNamesProduct(generated.title, titleProduct)') > 0 && G.indexOf('titleNamesProduct(generated.title, titleProduct)') < G.indexOf('── 8. Publish text post to WordPress'))
const M = read('supabase/migrations/385_post_site_by_address.sql')
check('migration 385 backfills and keeps posts filed by address', /update public\.blog_posts bp\s+set wordpress_site_id = ws\.id/.test(M) && /create trigger blog_posts_site_from_url/.test(M) && /if match is not null then/.test(M))
check('the Title Check page reads the live titles', /<LiveTitleCheck \/>/.test(read('app/(dashboard)/tools/title-audit/page.tsx')))

// ── The link, the video and the post agree (28 Sep: a baskets review at a
//    car-phone-holder address, linking the holder) ──
{
  const slug = 'jikasho-vacuum-magnetic-car-phone-holder-review'
  const holder = { brand: 'Jikasho', canonical: 'Jikasho Vacuum Magnetic Car Phone Holder' }
  check('a baskets body does not name the linked phone holder', !titleNamesProduct('The BROWNLILY handwoven storage baskets do exactly what the title says. With 16 kids...', holder).ok)
  check('a baskets title at a phone-holder address is off topic', titleFitsSlug('These Baskets Make Organization Look Good', slug) === 0 && titleFitsSlug('Jikasho Magnetic Phone Holder: Does It Hold?', slug) > 0)
  const G = read('app/api/blog/generate/route.ts')
  check('a post whose body never names the linked product is held, for every generation',
    /if \(productMismatch\) heldReasons\.push\(productMismatch\)/.test(G) && G.indexOf('if (productMismatch) heldReasons.push') < G.indexOf('if (body.autopilot === true)'))
  check('the title is not renamed to a product the body is not about', /if \(!bodyNames\) \{\s*productMismatch =/.test(G) && /\} else if \(!titleNamesProduct\(generated\.title, titleProduct\)\.ok\)/.test(G))
  check('a rebuild never puts mismatched content into a live post', /if \(productMismatch\) \{\s*return NextResponse\.json\(\{ error: `\$\{productMismatch\} Your live post/.test(G))
  check('a rebuild never overwrites a post whose address is about something else', /which is about something else, so it was not rebuilt and nothing was changed/.test(G))
  const L = read('app/api/tools/title-audit/live/route.ts')
  check('the live check lists posts about something other than their address', /offTopic\.push\(/.test(L) && /offTopic, unread/.test(L) && /res\.offTopic/.test(read('components/seo/LiveTitleCheck.tsx')))
  check('a held generation says so on the Content page', /Saved as a draft, not published\./.test(read('components/content/GenerateButton.tsx')) && /Draft, not published/.test(read('components/content/GenerateButton.tsx')))
}

if (failures.length) {
  console.error(`\n❌ post-site: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ post-site: writes land on the post MVP means, and titles name their product')
