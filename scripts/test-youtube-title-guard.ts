// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NO STAND-IN YOUTUBE TITLES (Jarett, 2026-11-11, on Drop: "it no longer gives
// me an accurate title for youtube; they're pretty generic e.g. THIS TEST,
// WORTH IT?, THIS PRODUCT REVIEW, THIS WIN?, BIG MISTAKE?". Seb: "I never want
// to see these generic, terrible titles.")
//
// The guard catches every stand-in MVP has sent before (Jarett's five, AMAZON
// TEST, the ASIN, the file name, a thumbnail line) and lets real titles
// through; the headline writer no longer has stock lines to fall back on; and
// the Drop button, the background worker and both uploads go through it.
import { readFileSync } from 'node:fs'

// No model is reached from a test: a closed local port answers every call.
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

;(async () => {
  const { genericTitleWhy, realTitles, looksLikeFileName } = await import('../lib/youtube-title-guard')
  const { generateProductTitleOptions } = await import('../lib/title-options')
  const { writeYouTubeTitles } = await import('../lib/youtube-title-writer')

  const jarett = ['THIS TEST', 'WORTH IT?', 'THIS PRODUCT REVIEW', 'THIS WIN?', 'BIG MISTAKE?']
  check('every one of Jarett’s titles is refused', jarett.every((t) => genericTitleWhy(t)), jarett.map((t) => [t, genericTitleWhy(t)]))
  const before = ['AMAZON TEST', 'AMAZON PRODUCT REVIEW', 'B0H3P7H9T2', 'B0H3P7H9T2 Review: Worth It?', 'IMG_4821.MOV', 'PXL_20261103_181502', 'CHIA WORTH IT?', 'FLY TRAP WORKS', 'This Product Review', '', '   ']
  check('every stand-in MVP sent before is refused too (shop names, the ASIN, file names, thumbnail lines)', before.every((t) => genericTitleWhy(t)), before.map((t) => [t, genericTitleWhy(t)]))
  check('a file name is told apart from words', looksLikeFileName('GOPR0042.MP4') && looksLikeFileName('20261103_181502') && !looksLikeFileName('Ninja Creami Deluxe Review'))
  const ninja = { brand: 'Ninja', canonical: 'Ninja Creami Deluxe' }
  const good = ['Ninja Creami Deluxe Review: Worth the Counter Space?', 'Is the Ninja Creami Deluxe Better Than a Regular Ice Cream Maker?', 'Beatbot AquaSense 2 Pool Robot After a Full Summer']
  check('real titles pass', good.slice(0, 2).every((t) => !genericTitleWhy(t, ninja)) && !genericTitleWhy(good[2]), good.map((t) => genericTitleWhy(t, ninja)))
  check('with the product known, a short title that does not name it is refused', genericTitleWhy('Best Kitchen Buy Ever', ninja) === 'it does not name the product')
  check('a title the creator wrote in their own words is not second-guessed for length', !genericTitleWhy('We Made Ice Cream Every Night For A Week And Here Is What Happened', ninja))
  check('only real titles are offered, once each', realTitles([...jarett, good[0], good[0].toUpperCase().toLowerCase(), 'B0H3P7H9T2'], ninja).join('|') === good[0])

  // The headline writer when the model does not answer.
  const none = await generateProductTitleOptions({ videoTitle: '', asin: '', count: 5, ctx: { userId: null, tier: null } })
  check('with no product name and no model, the headline writer writes nothing (not THIS TEST)', none.length === 0, none)
  const fromName = await generateProductTitleOptions({ videoTitle: '', productTitle: 'Ninja CREAMi Deluxe 11-in-1 Ice Cream & Frozen Treat Maker', count: 5, ctx: { userId: null, tier: null } })
  check('with the product’s name, its fallback lines are made of that name and none is a stock line', fromName.length > 0 && fromName.every((t) => /NINJA|CREAMI|DELUXE/.test(t)) && !fromName.some((t) => jarett.includes(t)), fromName)
  const fromFile = await generateProductTitleOptions({ videoTitle: 'IMG_4821.MOV', count: 5, ctx: { userId: null, tier: null } })
  check('a file name is not a subject either', fromFile.length === 0, fromFile)
  check('the short title writer writes nothing without the product’s name, and nothing when the model does not answer', (await writeYouTubeTitles({ productTitle: '', ctx: { userId: null, tier: null } })).length === 0 && (await writeYouTubeTitles({ productTitle: 'Ninja CREAMi Deluxe', ctx: { userId: null, tier: null } })).length === 0)
  const TO = read('lib/title-options.ts')
  check('the stock fallback list is gone from the headline writer', !/`\$\{noun\} TEST`|`BIG MISTAKE\?`,|`WORTH IT\?`,/.test(TO))

  // Where titles are written and sent.
  const T = read('app/api/launch/items/[id]/title/route.ts')
  check('the Drop button never uses the thumbnail headline writer for a YouTube title', !/generateProductTitleOptions/.test(T))
  check('the Drop button names the product, never sends Co-Pilot an empty title, checks every title, and has a short writer behind it', /productNameFor\(createAdminClient\(\), asin\)/.test(T) && /const subject = realHint \|\| found\?\.canonical \|\| found\?\.title \|\| asin/.test(T) && /realTitles\(\[j\.generated\?\.title/.test(T) && /writeYouTubeTitles\(/.test(T))
  check('with no product name and no title, the Drop button says so instead of guessing', /so it did not guess a title/.test(T))
  check('a product that does not match the video is said, not written around', /if \(j\.asinMismatch && j\.error\) return/.test(T))
  const W = read('app/api/cron/launch-drain/route.ts')
  check('the worker never saves the thumbnail line as the title', !/generateProductTitleOptions|async function productTitle\(/.test(W))
  check('the worker saves only a title that names the product', /const real = meta\.title \? realTitles\(\[meta\.title\.slice\(0, 100\)\], product\)\[0\]/.test(W) && /needsTitle && real/.test(W) && /if \(needsTitle && found && left\(\) > 60_000\)/.test(W))
  check('a title MVP saved before is checked again, so the old thumbnail lines are replaced', /titleSource !== 'mvp' \|\| !!genericTitleWhy\(title, product\)/.test(W))
  const g = W.indexOf('NO STAND-IN TITLE GOES TO YOUTUBE')
  check('the last look before upload comes before both uploads, rewrites a stand-in or holds the video and says why', g > 0 && g < W.indexOf('UPLOADED BY SCOUT IN YOUTUBE STUDIO, NOT HERE') && /Held back: its title/.test(W) && /title_source,description/.test(W))
  check('SCOUT’s Studio upload does not take a video under a stand-in title', /genericTitleWhy\(r\.title\)\) return false/.test(read('app/api/launch/studio-uploads/route.ts')))
  const L = read('lib/product-name-lookup.ts')
  check('the product name lookup fetches no Amazon page', !/services\/amazon'/.test(L) && !/\bfetch\(/.test(L) && /keepa_product_cache/.test(L) && /getItemsByAsin/.test(L))
  const words = (src: string) => (src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').match(/'[^'\n]*'|`[^`\n]*`/g) || []).join(' ')
  check('no dashes in what a creator reads', ![T, read('lib/youtube-title-guard.ts')].some((s) => /[–—]| - /.test(words(s))))

  if (fails.length) { console.error(`❌ youtube-title-guard: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
  console.log('✅ youtube-title-guard: no stand-in title (THIS TEST, WORTH IT?, the ASIN, a file name, a thumbnail line) is offered, saved or uploaded; titles name the product or MVP says why')
})()
