/**
 * WHAT WAS TRIMMED ON 2026-10-05, AND WHAT REPLACED IT (Seb, from usage data).
 *
 *   Instagram AI images   retired: never used; Clip Factory posts real
 *                         vertical clips. The free thumbnail compose stays.
 *   Facebook designs      no longer designed: Facebook reuses the product's
 *                         thumbnail or Instagram design, and only when there
 *                         is neither does MVP make the thumbnail (once).
 *   Walmart / Wayward     one shared quick-post window instead of two copies.
 *
 * Run: npx tsx scripts/test-feature-trim.ts
 */
import { readFileSync } from 'node:fs'
import { INSTAGRAM_AI_IMAGES } from '../lib/ig-ai-images'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

// ── Instagram AI images ─────────────────────────────────────────────────────
check('the switch is off', INSTAGRAM_AI_IMAGES === false)
const M = read('components/content/InstagramPublishModal.tsx')
check('the Instagram window never offers the AI image while off', /const aiIsPro = INSTAGRAM_AI_IMAGES && \(/.test(M))
const R = read('app/api/instagram/generate-ai-image/route.ts')
const refuse = R.indexOf("if (!INSTAGRAM_AI_IMAGES && tier !== 'admin')")
check('the server refuses before rendering, and says what replaced it', refuse > 0 && refuse < R.indexOf('composeWithGptImage(') && /Clip Factory/.test(R))

// ── Facebook reuses ─────────────────────────────────────────────────────────
const T = read('app/api/youtube/generate-thumbnail/route.ts')
check('a Facebook request is answered before anything renders', /const fb = await facebookFromWhatExists\(request\)\n\s*if \(fb\.reused\) return fb\.reused/.test(T))
check('it reuses the thumbnail first, then the Instagram design, then the story', /recallProductImage\(supabase, user\.id, asin\)[\s\S]{0,200}recallDesigns\(supabase, user\.id, asin, 'ig'\)[\s\S]{0,120}recallDesigns\(supabase, user\.id, asin, 'story'\)/.test(T))
check('the answer says it was reused', /reusedNote: `Reused your \$\{what\} for this product\. Nothing new was made\.`/.test(T))
check('with nothing to reuse it makes the 16:9 thumbnail, remembered for next time', /format: 'landscape', memorySurface: \(b\.memorySurface as string\) \|\| 'Facebook'/.test(T))
check('the composer shows the reuse note', /setReusedNote\(typeof data\.reusedNote === 'string'/.test(read('components/amazon/PostComposer.tsx')))

// ── Walmart and Wayward share one window ────────────────────────────────────
for (const f of ['components/walmart/WalmartQuickPostModal.tsx', 'components/wayward/WaywardQuickPostModal.tsx']) {
  const s = read(f)
  check(`${f}: is the shared window, not a copy`, /<PartnerQuickPostModal/.test(s) && !/useState/.test(s))
}

if (failures.length) {
  console.error('❌ feature-trim guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ feature-trim guard passed (Instagram AI images retired, Facebook reuses, one partner quick-post window)')
