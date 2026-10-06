/**
 * EVERY RENDER COUNTS AGAINST THE PLAN (Seb, 2026-10-05).
 *
 * Three renders used to sit outside every allowance: the expression portrait
 * made before a design, the Instagram re-render after a failed product check,
 * and the Liftoff plain thumbnail made when the designed one was refused. Each
 * now counts, and each is built to run less often: a checked portrait is kept
 * and reused, the Instagram re-render is told what was wrong, and the plain
 * thumbnail never runs after the plan said no.
 *
 * Run: npx tsx scripts/test-render-counting.ts
 */
import { readFileSync } from 'node:fs'
import { PRIMARY_FEATURE } from '../lib/usage-cap'
import { portraitCachePath } from '../lib/expression-portrait-cache'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

// ── Expression portraits ────────────────────────────────────────────────────
const T = read('app/api/youtube/generate-thumbnail/route.ts')
check('a portrait counts as one design of the same kind (same feature, same cap)',
  /const recordPortrait = \(\) => recordUsage\(\{ userId: TELEMETRY\.userId, tier: TELEMETRY\.tier, feature: gfxFeature, model: PORTRAIT_COST_MODEL, images: 1 \}\)/.test(T))
check('a portrait bills at medium, the quality it renders at', /const PORTRAIT_COST_MODEL = 'gpt-image-1-medium'/.test(T) && /size: '1024x1024', quality: 'medium'/.test(T))
check('the old uncounted feature is gone', !/feature: 'yt_thumb_expression_portrait'/.test(T))
check('a kept portrait is used before anything renders', T.indexOf('await readCachedPortrait(cachePath)') < T.indexOf('let posed = cached ??'))
check('only a portrait that passed the check is kept', /if \(posed && expressionVerified === true && cachePath\) await writeCachedPortrait\(cachePath, posed\)/.test(T))
const a = Buffer.from('selfie-a'), b = Buffer.from('selfie-b')
const base = { userId: 'u1', refs: [a], expressionKey: 'excited', prompt: 'p' }
check('the same selfies and expression find the same portrait', portraitCachePath(base) === portraitCachePath({ ...base }))
check('new selfies make a new portrait', portraitCachePath(base) !== portraitCachePath({ ...base, refs: [b] }))
check('another expression makes a new portrait', portraitCachePath(base) !== portraitCachePath({ ...base, expressionKey: 'shocked' }))
check('a changed prompt makes a new portrait', portraitCachePath(base) !== portraitCachePath({ ...base, prompt: 'p2' }))
check('portraits are kept in the creator\'s own folder', portraitCachePath(base).startsWith('u1/expression-portraits/'))

// ── Instagram re-render ─────────────────────────────────────────────────────
check('the Instagram re-render counts against the Instagram allowance', PRIMARY_FEATURE.instagramAi.includes('ig_ai_thumbnail_retry_cost'))
const IG = read('app/api/instagram/generate-ai-image/route.ts')
check('the re-render is told what was wrong', /THE PREVIOUS RENDER GOT THE PRODUCT WRONG: \$\{verdict\.reason\}/.test(IG))
check('the usage page counts the same rows the cap does', /countFeatures\(PRIMARY_FEATURE\.instagramAi\)/.test(read('app/api/usage/summary/route.ts')))

// ── Liftoff plain thumbnail ─────────────────────────────────────────────────
check('the plain product thumbnail counts as a thumbnail', PRIMARY_FEATURE.thumbnail.includes('product_thumbnail') && PRIMARY_FEATURE.thumbnail.includes('product_thumbnail_clean'))
const P = read('lib/product-thumbnail.ts')
check('the plain thumbnail checks the allowance and the spend ceiling before it renders',
  P.indexOf('if (!(await productThumbnailAllowed(sb, opts.userId, opts.tier)).ok) return null') > 0 &&
  P.indexOf('if (!(await productThumbnailAllowed(') < P.indexOf('composeWithNanoBananaPro(') &&
  /await spendGate\(userId, tier\)/.test(P) && /checkUsageCap\(sb, userId, \[\.\.\.PRIMARY_FEATURE\.thumbnail, 'yt_thumb_graphic'\]/.test(P))

if (failures.length) {
  console.error('❌ render-counting guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ render-counting guard passed (portraits, Instagram re-renders and Liftoff plain thumbnails all count)')
