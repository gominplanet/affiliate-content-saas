/**
 * PAID AI ANSWERS TO THE SPEND CEILING, AND A FREE TRIAL ENDS FOR ALL OF IT.
 *
 * Audit 2026-10-06, with a video ad bringing in free-trial signups:
 *
 *  1. An EXPIRED trial was stopped only on the thumbnail, photobooth and face
 *     routes. Every text route (captions, scripts, the assistant, pin copy)
 *     kept spending up to the trial ceiling every calendar month, forever,
 *     and a trial that spanned the 1st got that ceiling twice.
 *  2. The public product-finder widget billed the creator per visitor with only
 *     a per-instance, per-minute limiter: a stranger with the site URL could
 *     run it all day and drain that creator's own monthly ceiling.
 *  3. The assistant had a message cap but no spend ceiling and no length limit.
 *  4. Captions for direct TikTok/Instagram posts skipped the house scrub, and
 *     the final slice to the platform cap cut the FTC disclosure first.
 *
 * Run: npx tsx scripts/test-spend-gates.ts
 */
import { readFileSync } from 'node:fs'
import { spendUpgradeFor } from '../lib/ai-spend'
import { FREE_TRIAL_OVER_MESSAGE, freeTrialExpiredBlock } from '../lib/free-trial'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const DASH = /[–—]/

// ── the ceiling itself ──────────────────────────────────────────────────────
const SPEND = read('lib/ai-spend.ts')
check('a trial sums its spend from signup, not the calendar month',
  /since = freeTrialWindow\(signupISO\)\.startISO/.test(SPEND) && /monthlyAiSpendUsd\(userId, since\)/.test(SPEND))
check('an expired trial counts as exceeded, so every gated route stops',
  /const exceeded = trialOver \|\|/.test(SPEND))
check('an unreadable signup date never expires an account',
  /if \(signupISO\) \{[\s\S]{0,200}trialOver =/.test(SPEND))
check('the expired-trial sentence is the same one the image routes show',
  freeTrialExpiredBlock({ tier: 'trial', signupISO: '2020-01-01T00:00:00Z' }) === FREE_TRIAL_OVER_MESSAGE
  && /FREE_TRIAL_OVER_MESSAGE/.test(SPEND))
check('a trial is never told its free AI "resets on the 1st"',
  /if \(status\.tier === 'trial'\) \{[\s\S]{0,600}\}, \{ status: 403 \}\)\s*\}\s*return NextResponse\.json\(\{\s*error:\s*`Generation is paused on this account for now\. It resets on the 1st/.test(SPEND))
const gateBody = SPEND.slice(SPEND.indexOf('export async function spendGate'))
check('no dash in any spend-gate message', !/error:[^\n]*[–—]/.test(gateBody) && !/`[^`\n]*[–—][^`\n]*`/.test(gateBody))
check('the pause offers only plans on sale: free goes to Amazon', spendUpgradeFor('trial')?.tier === 'amazon')
check('legacy plans go to Pro, never Studio', spendUpgradeFor('creator')?.tier === 'pro' && spendUpgradeFor('studio')?.tier === 'pro' && spendUpgradeFor('amazon')?.tier === 'pro')
check('Pro has nowhere to go', spendUpgradeFor('pro') === null && spendUpgradeFor('admin') === null)
check('the upgrade object never carries the dollar ceiling', spendUpgradeFor('trial')?.limit === null)

// ── every paid route that had no ceiling now has one, before the model call ─
const GATED: Array<[string, RegExp]> = [
  ['app/api/assistant/chat/route.ts', /anthropic\.messages\.stream\(/],
  ['app/api/assistant/memory/route.ts', /mergeAssistantMemory\(/],
  ['app/api/thumbnails/logo-scan/route.ts', /createAnthropicClient\(\)/],
  ['app/api/tools/title-audit/scan/route.ts', /createClaudeService\(\)/],
  ['app/api/blog/tiktok-post/video-meta/route.ts', /await generateDirectCaption\(/],
  ['app/api/instagram/post-direct-video/video-meta/route.ts', /await generateDirectCaption\(/],
  ['app/api/launch/items/[id]/title/route.ts', /await generate(Amazon|Product)TitleOptions\(/],
]
for (const [file, paid] of GATED) {
  const s = read(file)
  const gate = s.search(/await spendGate\(/)
  const call = s.search(paid)
  check(`${file}: spend gate before the paid call`, gate > 0 && call > 0 && gate < call)
}
const HERO = read('lib/blog-hero.ts')
check('the rebuild-thumbnail button checks the ceiling before generating',
  HERO.indexOf('checkSpendCeiling(opts.userId') > 0 && HERO.indexOf('checkSpendCeiling(opts.userId') < HERO.indexOf('generateArtDirectorBlogHero({'))

// ── the assistant ───────────────────────────────────────────────────────────
const CHAT = read('app/api/assistant/chat/route.ts')
check('assistant: a message has a length limit', /message\.length > ASSISTANT_MAX_MESSAGE_CHARS/.test(CHAT))

// ── the public product finder ───────────────────────────────────────────────
const PF = read('app/api/blog/product-finder/route.ts')
const pfCall = PF.indexOf('createAnthropicClient()')
check('product finder: a daily cap per site, counted in ai_usage (holds across instances)',
  /PRODUCT_FINDER_DAILY_CAP/.test(PF) && /\.eq\('feature', 'product_finder'\)/.test(PF) && PF.indexOf("eq('feature', 'product_finder')") < pfCall)
check('product finder: the creator\'s spend ceiling applies before the model call',
  PF.indexOf('checkSpendCeiling(userId') > 0 && PF.indexOf('checkSpendCeiling(userId') < pfCall)
check('product finder: a failed answer is not shown as "no match"', /status: 502|\}, 502\)/.test(PF))

// ── published captions ──────────────────────────────────────────────────────
const DC = read('lib/direct-caption.ts')
check('direct captions go through the house scrub', /return scrubBanned\(out\)/.test(DC))
check('direct-caption hooks lose a year stamp', (DC.match(/const hook = scrubTitle\(/g) || []).length === 2)
check('the disclosure is the tail, never what the cap cuts',
  /assembleCaption\(\[hook, body, hashtags\.join\(' '\)\], \[disclaimer\]/.test(DC)
  && /assembleCaption\(\[hook, body\], \[cta, hashtags\.join\(' '\), disclaimer\]/.test(DC)
  && !/\.join\('\\n\\n'\)\.slice\(0, rules\.charCap\)/.test(DC))
check('no em dash in a default disclaimer', !/affiliateDisclaimer\.trim\(\) \|\|\s*'[^']*[–—]/.test(DC))
const PA = read('lib/pin-assets.ts')
const pinDisc = (PA.match(/export const AFFILIATE_DISCLAIMER = '([^']*)'/) || [])[1] || ''
check('the pin disclaimer has no dash and still discloses', !!pinDisc && !DASH.test(pinDisc) && /Amazon Associate/.test(pinDisc))
const SP = read('lib/shorts-planner.ts')
check('Short hooks and captions use the house scrubs', /hook: scrubTitle\(/.test(SP) && /caption: scrubBanned\(/.test(SP))

if (failures.length) {
  console.error('❌ spend-gates guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ spend-gates guard passed (trial ends everywhere, ceiling before every paid call listed, public finder bounded, captions scrubbed with the disclosure kept)')
