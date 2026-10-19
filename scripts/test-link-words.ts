// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY LINK SAYS WHERE IT GOES (Seb, 2026-10-19: "any hyperlink that a
// customer may see and may click on, they need to know where they're going to
// end up. So if it's an Amazon link, it needs to say ... on Amazon ... Same
// thing if we sent them to Walmart, or to Best Buy").
//
// lib/store-name is the one answer, and this guard holds each surface MVP
// writes a link on to it: deal banners and buttons, blog and comparison
// buttons, from-link posts, shop tiles, social product lines, Pinterest pins,
// and the writer's own links in a post.
import { readFileSync } from 'node:fs'
import { storeOf, priceCta, seeItOn } from '../lib/store-name'
import { shopCtaLabel } from '../lib/link-in-bio'
import { productCtaLine } from '../lib/social-link-mode'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── The store, from the link ─────────────────────────────────────────────────
check('Amazon by its address', storeOf('https://www.amazon.com/dp/B0ABCDEFGH') === 'Amazon')
check('Walmart, Best Buy and Target by their address', storeOf('https://www.walmart.com/ip/123') === 'Walmart' && storeOf('https://www.bestbuy.com/site/x') === 'Best Buy' && storeOf('https://www.target.com/p/x') === 'Target')
check('TikTok Shop by its address', storeOf('https://shop.tiktok.com/view/product/1729') === 'TikTok Shop')
check('a brand store names its own site', storeOf('https://www.fender.com/en-US/x') === 'fender.com')
check('a short link that hides its store names none', storeOf('https://geni.us/abc') === null && storeOf('https://www.mvpl.ink/x7k') === null && storeOf('https://bit.ly/x') === null)
check('unless an ASIN says Amazon', storeOf('https://geni.us/abc', 'B0ABCDEFGH') === 'Amazon')
check('nothing at all is nothing', storeOf('') === null && storeOf(null) === null)
check('the price words name the store', priceCta('Amazon') === "Check today's price on Amazon" && seeItOn('Walmart') === 'See it on Walmart')

// ── Shop tiles and social lines ──────────────────────────────────────────────
check('a shop tile names a known store', shopCtaLabel({ url: 'https://www.walmart.com/ip/1' }) === 'Buy now from Walmart')
check('a shop tile names a brand site', shopCtaLabel({ url: 'https://www.fender.com/x' }) === 'Buy now from fender.com')
check('a shop tile with an ASIN says Amazon', shopCtaLabel({ url: 'https://geni.us/x', asin: 'B0ABCDEFGH' }) === 'Buy now from Amazon')
check('only a hidden store is "Shop now"', shopCtaLabel({ url: 'https://geni.us/x' }) === 'Shop now')
check('a social line names Amazon', productCtaLine('https://geni.us/x', true).includes('on Amazon'))
check('a social line names another store', productCtaLine('https://www.bestbuy.com/site/x', false).includes('Get it on Best Buy'))
check('a social line for a hidden store does not guess', productCtaLine('https://bit.ly/x', false) === '🛒 Get it here 👉 https://bit.ly/x')

// ── Every surface uses it ────────────────────────────────────────────────────
const DEALS = read('app/api/deals/route.ts')
const PLUGIN = read('wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php')
const QUICK = read('lib/deal-quick-post.ts')
const BLOG = read('app/api/blog/generate/route.ts')
const CMP = read('app/api/blog/comparison/route.ts')
const FROM = read('app/api/blog/from-link/route.ts')
const CLAUDE = read('services/claude/index.ts')
const MULTI = read('lib/multi-product.ts')
const PIN = read('lib/amazon-pin-publish.ts')

check('a deal sent to a TikTok Shop says TikTok Shop on social', /retailerLabel: destination\.kind === 'showcase' \? 'TikTok Shop' : 'Amazon'/.test(QUICK))
check('the deal banner and button carry their store', /store: dealDestination\.kind === 'showcase' \? 'TikTok Shop'/.test(DEALS) && /See the deal on <\?php echo esc_html\(\$store\); \?>/.test(PLUGIN))
check('the deal button says the store even after the deal ends', /before you buy/.test(PLUGIN) && !/\?azon/.test(PLUGIN))
check('the deal post\'s closing link names the store', /const anchorWords = anchorStore/.test(DEALS) && /\$\{anchorWords\}/.test(DEALS))
check('a creator\'s own store link names that store on the blog buttons', /const destinationStore = walmartLead \? 'Walmart' : asinOverride \? null : storeOf\(destination\)/.test(BLOG) && /destinationStore !== 'Amazon'/.test(BLOG))
check('each shop-everything row names its store', /primaryStore/.test(BLOG) && /store: opts\.primaryStore \?\? storeOf\(primaryUrl\)/.test(MULTI))
check('comparison buttons name the store', /priceCta\(wProd\.store\)/.test(CMP) && /See \$\{btnName\} on \$\{scrub\(p\.store\)\}/.test(CMP) && /recProduct\.store \? ` on \$\{scrub\(recProduct\.store\)\}`/.test(CMP))
check('the comparison never says "price on" a product name', !/Check today's price on \$\{recName\}/.test(CMP))
check('from-link buttons name the store', /const linkStore = tiktokProductId \? 'TikTok Shop' : asin \? 'Amazon' : storeOf\(/.test(FROM) && /See it on \$\{linkStore\}/.test(FROM))
check('the writer is told to name the store in its own links', /const linkStoreWord = retailerLabel \|\| \(isAmazon \? 'Amazon' : null\)/.test(CLAUDE) && /The words of every link say it opens \$\{linkStoreWord\}/.test(CLAUDE))
check('and not to guess one it does not know', /Do not name a store: this link's store is not known/.test(CLAUDE))
check('a pin says where it goes', /const store = asin \? 'Amazon' : storeOf\(opts\.productUrl\)/.test(PIN) && /See it on \$\{store\}\./.test(PIN))

const CLAUDE_MD = read('CLAUDE.md')
check('the rule is written down', /Links say where they go/.test(CLAUDE_MD))

if (failures.length) {
  console.error(`\n❌ link-words: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ link-words: every link MVP writes says which store it opens, and none guesses a store it does not know')
