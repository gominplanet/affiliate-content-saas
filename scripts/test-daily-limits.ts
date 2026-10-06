/**
 * DAILY LIMITS ON THE ACTIONS THAT HAD NONE.
 *
 * Seb, 2026-10-05: one LTK, Levanta, Walmart or Wayward post a day, and ten
 * Clip Factory "Find moments" a day. Each limit is checked before the paid
 * work starts and counted only after it succeeded, so a failure never uses up
 * the day. The refusal names the limit and when it resets, and Find moments
 * shows it as a reason, not an upgrade prompt (it is not a plan wall).
 *
 * Also checked: the AI assistant caches its stable system prompt.
 *
 * Run: npx tsx scripts/test-daily-limits.ts
 */
import { readFileSync } from 'node:fs'
import { utcDayStart, PARTNER_POSTS_PER_DAY } from '../lib/partner-post-limit'
import { FIND_MOMENTS_PER_MONTH, FIND_MOMENTS_PER_DAY_LEGACY, findMomentsAllowance } from '../lib/find-moments-limit'
import { LEGACY_PRO_COHORT } from '../lib/tier'

const read = (p: string) => readFileSync(p, 'utf8')
const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }

check('one partner post a day', PARTNER_POSTS_PER_DAY === 1)
check('new members: 60 Find moments a month', FIND_MOMENTS_PER_MONTH === 60 && findMomentsAllowance(null).per === 'month')
check('Pro members from before: 10 a day, kept for good', FIND_MOMENTS_PER_DAY_LEGACY === 10 && findMomentsAllowance(LEGACY_PRO_COHORT).per === 'day')
check('the day starts at midnight UTC', utcDayStart(new Date('2026-10-05T23:59:00-07:00')).toISOString() === '2026-10-06T00:00:00.000Z')

const P = read('lib/partner-post-limit.ts')
check('partner limit: admin is not limited', /if \(tier === 'admin'\) return null/.test(P))
check('partner posts need a plan with a blog', /\(TIERS\[tier\]\?\.sites \?\? 0\) === 0/.test(P))
check('partner limit: the refusal says when the next one is available', /The next one is available after midnight UTC/.test(P))

for (const partner of ['ltk', 'levanta', 'walmart', 'wayward']) {
  const s = read(`app/api/${partner}/generate/route.ts`)
  const at = s.indexOf('await partnerPostLimit(user.id, tier)')
  const rec = s.indexOf('recordPartnerPost(user.id, tier)')
  const firstPaid = s.search(/createAnthropicClient\(|buildCampaignHero\(|messages\.create\(/g)
  check(`${partner}: checks the daily limit`, at > 0)
  check(`${partner}: checks before any paid call`, at > 0 && (firstPaid < 0 || at < firstPaid))
  check(`${partner}: counts the post only after it was made`, rec > at && rec < s.lastIndexOf('ok: true'))
}

const F = read('lib/find-moments-limit.ts')
check('find moments: admin is not limited', /normalizeTier\(rawTier\) === 'admin'\) return null/.test(F))
check('find moments: the refusal carries its own cap', /cap: 'shorts_find'/.test(F))
const PL = read('app/api/youtube/shorts/plan/route.ts')
check('find moments: posting the whole video is not a search', /whole !== true\) \{\s*const daily = await findMomentsLimit\(user\.id, tier\)/.test(PL))
check('find moments: counted only when moments were found', /if \(clips\.length > 0\) recordFindMoments\(user\.id, tier\)/.test(PL))
const SC = read('components/vertical/ShortsCreatePanel.tsx')
check('find moments: the limit shows as a reason, not an upgrade prompt', /data\.cap === 'shorts_find'\) throw new Error/.test(SC) &&
  SC.indexOf("data.cap === 'shorts_find'") < SC.indexOf('dispatchCapReached(data.error'))

const LF = read('app/api/live/followup/route.ts')
check('Live follow-up has the spend ceiling on its paid actions', /if \(mode === 'paid'\) \{\s*const blocked = await spendGate\(user\.id, intg\?\.tier\)/.test(LF) && /export async function POST\(req: NextRequest\) \{\s*const g = await gate\(\)/.test(LF))
check('the Find moments audio pull is booked', /recordUsage\(\{ userId: user\.id, tier, feature: 'shorts_ingest', model: 'youtube-ingest', images: 1 \}\)/.test(PL))
check('the Launchpad master Whisper run is booked', /feature: 'launchpad_transcribe', model: 'fal-whisper'/.test(read('app/api/launchpad/master/route.ts')))

const A = read('app/api/assistant/chat/route.ts')
check('assistant: the stable system prompt is cached', /text: sys\.stable, cache_control: \{ type: 'ephemeral'( as const)? \}/.test(A))

if (failures.length) {
  console.error('❌ daily-limits guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ daily-limits guard passed (1 partner post a day, Find moments 60 a month or 10 a day for earlier Pro members; assistant prompt cached)')
