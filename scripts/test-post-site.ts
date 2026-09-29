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
  check('the live check lists posts about something other than their address', /offTopic\.push\(/.test(L) && /offTopic, shared, unread/.test(L) && /res\.offTopic/.test(read('components/seo/LiveTitleCheck.tsx')))
  check('the live check lists posts claimed by more than one video', /const shared = \[\.\.\.sharing\.values\(\)\]\.filter\(\(g\) => g\.length > 1\)/.test(L) && /res\.shared/.test(read('components/seo/LiveTitleCheck.tsx')))
  check('a record unlinked from a post does not carry that post\'s address into its new one', /const slug = \(existingForLimit\?\.wordpress_post_id \? existingSlug : null\) \|\| generated\.slug/.test(G))
  check('a post that is another video\'s in MVP is never adopted by address', /\.neq\('video_id', videoId\)\.limit\(1\)\s*if \(claimed && claimed\.length\)/.test(G))
  check('a held generation says so on the Content page', /Saved as a draft, not published\./.test(read('components/content/GenerateButton.tsx')) && /Draft, not published/.test(read('components/content/GenerateButton.tsx')))
}

// ── WordPress setup reads the saved password decrypted (29 Sep: a creator's
//    token setup stopped at "your hosting strips the Authorization header") ──
{
  const S = read('app/api/wordpress/connect-and-setup/route.ts')
  check('the token setup decrypts the stored password before logging in', /resolvedAppPw = maybeDecrypt\(intRow\.wordpress_app_password\)/.test(S) && !/resolvedAppPw = intRow\.wordpress_app_password/.test(S))
  check('a host that strips the login header gets the fix, not only the diagnosis', /fix: 'To fix it: open your host/.test(S) && /data\.fix\]\.filter\(Boolean\)/.test(read('app/(dashboard)/setup/page.tsx')))
}

// ── Brand names are never altered (29 Sep: COOFANDY written as "Kofandi") ──
{
  const B = require('../lib/brand-spelling') as typeof import('../lib/brand-spelling')
  const r = B.fixBrandSpelling('<h2>Kofandi Quarter Zip Pullover</h2><p>The Kofandi sweater. <a href="https://x.co/kofandi">buy</a></p>', 'COOFANDY')
  check('a heard spelling of the brand is put back to the listing\'s, in text only', r.text.includes('<h2>COOFANDY Quarter Zip') && r.text.includes('The COOFANDY sweater') && r.text.includes('https://x.co/kofandi') && r.replaced.join() === 'Kofandi')
  check('and in the address', B.fixBrandInSlug('kofandi-quarter-zip-pullover-review', 'COOFANDY') === 'coofandy-quarter-zip-pullover-review')
  check('ordinary words are left alone', B.fixBrandSpelling('An Anchor, a Sharp knife, a Bird.', 'Anker').text === 'An Anchor, a Sharp knife, a Bird.'
    && B.fixBrandSpelling('The Sharp knife', 'SHARPIE').text === 'The Sharp knife' && B.fixBrandSpelling('Bird and Club', 'Beard Club').text === 'Bird and Club')
  check('a multi-word brand is fixed as a phrase', B.fixBrandSpelling('the Beerd Club trimmer', 'Beard Club').text === 'the Beard Club trimmer')
  const G = read('app/api/blog/generate/route.ts')
  check('generation takes the brand from Keepa by ASIN and applies it before the slug and again before publishing',
    /fetchKeepaIdentity\(\[effectiveAsin\]\)/.test(G) && G.indexOf('BRAND NAMES ARE NEVER ALTERED') < G.indexOf('// Preserve the slug of any existing live WP post')
    && /if \(officialBrand\) \{ content = byBrand\(content\); generated\.title = byBrand\(generated\.title\) \}/.test(G) && /brandFix: brandFixes\.size/.test(G))
  const M = read('lib/multi-product.ts')
  check('the shop list has no em dash in its words', !/in one place —/.test(M) && !/<\/strong> — <a/.test(M))
}

check('a post whose address was renamed in WordPress is still recognised (old-slug redirect followed)', /if \(expectedUrl && await redirectsTo\(expectedUrl, who\)\) return \{ ok: true/.test(read('lib/post-site.ts')))

if (failures.length) {
  console.error(`\n❌ post-site: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ post-site: writes land on the post MVP means, and titles name their product')
