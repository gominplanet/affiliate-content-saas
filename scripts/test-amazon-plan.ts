// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE AMAZON PLAN COVERS THE AMAZON INFLUENCER'S WHOLE LOOP.
//
// Seb, 2026-10-05: "add all six", for current and new Amazon members: Bulk
// Amazon upload, one YouTube channel with Co-Pilot, pinned and On sale
// comments, Amazon Live prep and follow-up, Clip Factory with its own
// allowance (Instagram and Facebook Reels, no TikTok), and deal posts counted
// against the 150 the pricing page promises. The blog, partner networks, X,
// Threads, TikTok and Meta Hub stay Pro.
//
// Run: npx tsx scripts/test-amazon-plan.ts
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: string) => { if (!ok) failures.push(detail ? `${name}: ${detail}` : name) }
const r = (p: string) => readFileSync(p, 'utf8')

async function main() {
  const { canUsePreview } = await import('../lib/labs-preview')
  const { TIERS } = await import('../lib/tier')
  const P = await import('../lib/amazon-plan')
  const { shortsCapFor, SHORTS_MONTHLY_CAP } = await import('../lib/usage-cap')
  const { findMomentsAllowance } = await import('../lib/find-moments-limit')

  // ── the switches ──────────────────────────────────────────────────────────
  for (const f of ['first_comment', 'on_sale', 'amazon_live', 'live_followup', 'studio_upload', 'facebook_reels'] as const) {
    check(`the Amazon plan has ${f}`, canUsePreview(f, 'amazon') && canUsePreview(f, 'pro'))
  }
  for (const f of ['brand_recap', 'deal_aftercare', 'facebook_setup', 'post_refresh'] as const) {
    check(`${f} stays Pro`, !canUsePreview(f, 'amazon') && canUsePreview(f, 'pro'))
  }
  check('admin-only previews stay admin only', !canUsePreview('video_plan', 'amazon') && !canUsePreview('video_plan', 'pro'))
  check('Bulk Amazon upload and Clip Factory: Pro, admin and Amazon only',
    P.hasVideoTools('amazon') && P.hasVideoTools('pro') && P.hasVideoTools('admin') && !P.hasVideoTools('trial') && !P.hasVideoTools('creator'))

  // ── the allowances ────────────────────────────────────────────────────────
  check('one YouTube channel and 100 Co-Pilot runs', TIERS.amazon.youtubeChannels === 1 && TIERS.amazon.metadataGensPerMonth === 100
    && P.AMAZON_YOUTUBE_CHANNELS === 1 && P.AMAZON_COPILOT_RUNS_PER_MONTH === 100)
  check('50 clips a month on Amazon, Pro unchanged', shortsCapFor('amazon') === 50 && shortsCapFor('pro') === SHORTS_MONTHLY_CAP && shortsCapFor('admin') === null)
  check('20 Find moments a month on Amazon', JSON.stringify(findMomentsAllowance(null, 'amazon')) === JSON.stringify({ limit: 20, per: 'month' }))
  check('4 Live shows a month', P.AMAZON_LIVE_SHOWS_PER_MONTH === 4)
  check('150 deal posts a month', TIERS.amazon.dealsPerMonth === 150)

  // ── the routes let Amazon in ──────────────────────────────────────────────
  const ROUTES = [
    'app/api/launch/batches/route.ts', 'app/api/launch/batches/[id]/launch/route.ts', 'app/api/launch/batches/[id]/amazon/route.ts',
    'app/api/launch/batches/[id]/availability/route.ts', 'app/api/youtube/shorts/plan/route.ts', 'app/api/youtube/shorts/ingest/route.ts',
    'app/api/youtube/shorts/render/route.ts', 'app/api/clip-factory/reframe/route.ts', 'app/api/clip-factory/publish-kit/route.ts',
    'app/api/instagram/publish-burned/route.ts',
  ]
  for (const p of ROUTES) {
    const s = r(p)
    check(`${p} lets the Amazon plan in`, /hasVideoTools\(/.test(s) && !/\['pro', 'admin'\]\.includes\(normalizeTier/.test(s) && !/tier !== 'pro' && tier !== 'admin'/.test(s))
  }
  check('the clip cap is read per plan where it is enforced',
    /const capLimit = shortsCapFor\(tier\)/.test(r('app/api/youtube/shorts/render/route.ts')) && /const limit = shortsCapFor\(tier\)/.test(r('app/api/youtube/shorts/usage/route.ts')))
  const CF = r('components/clip-factory/ClipFactory.tsx')
  check('Clip Factory opens for Amazon and offers no TikTok there', /const isPro = hasVideoTools\(tier\)/.test(CF) && /\{tiktokOk && <button onClick=\{\(\) => applyDestMode\('tiktok'/.test(CF))

  // ── the counted allowances are checked before the paid work ──────────────
  const LP = r('app/api/live/plan/route.ts')
  check('Live prep counts shows before writing one', LP.indexOf("amazonLiveLimit(user.id, tier, 'plan')") > 0 && LP.indexOf("amazonLiveLimit(user.id, tier, 'plan')") < LP.indexOf('anthropic.messages.create('))
  const LF = r('app/api/live/followup/route.ts')
  check('Live follow-up counts before starting one', LF.indexOf("amazonLiveLimit(g.userId, g.tier, 'followup')") > 0 && LF.indexOf("amazonLiveLimit(g.userId, g.tier, 'followup')") < LF.indexOf(".from('live_followups').insert("))
  const DP = r('app/api/deal-radar/social-post/route.ts')
  check('deal posts are checked before posting and counted after',
    DP.indexOf('await dealPostLimit(user.id, tier)') > 0 && DP.indexOf('await dealPostLimit(user.id, tier)') < DP.indexOf('executeDealQuickPost(')
    && /if \(anyOk\) recordDealPost\(user\.id, tier\)/.test(DP) && /recordDealPost\(user\.id, tier\)\n/.test(DP))

  // ── Amazon-only batches write no YouTube text ─────────────────────────────
  check('an Amazon-only batch needs no YouTube description',
    /let haveDescription = !!String\(it\.description \|\| ''\)\.trim\(\) \|\| await isAmazonOnly\(String\(it\.batch_id\)\)/.test(r('app/api/cron/launch-drain/route.ts')))

  // ── the menu and the walls ────────────────────────────────────────────────
  const S = r('components/layout/DashboardShellV2.tsx')
  const walls = S.slice(S.indexOf('const AMAZON_LOCKED_PREFIXES'), S.indexOf('const amazonLocked'))
  for (const p of ['/co-pilot', '/clip-factory', '/connect-youtube']) check(`${p} is no longer walled off for Amazon`, !walls.includes(`prefix: '${p}'`))
  for (const p of ['/content', '/setup', '/seo', '/levanta']) check(`${p} stays Pro`, walls.includes(`prefix: '${p}'`))
  check('Amazon connects its YouTube channel under Connections', /href: amazonView \? '\/connect-youtube' : '\/setup'[^\n]*onAmazon: 'included'/.test(S))
}

main().then(() => {
  if (failures.length) {
    console.error(`\n❌ amazon-plan: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✓ amazon-plan: Bulk Amazon upload, YouTube and Co-Pilot, comments, Amazon Live, Clip Factory and counted deal posts are on the Amazon plan, each with its allowance; the blog and the rest stay Pro')
})
