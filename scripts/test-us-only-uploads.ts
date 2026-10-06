// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AMAZON UPLOADS GO TO THE US STORE ONLY, AND NOTHING IS DUBBED.
//
// Decided 2026-10-01: Amazon's Global Storefront shows a creator's US videos in
// the other countries, so MVP stops uploading, translating and dubbing for
// them. Every path that could still do one of those is pinned here, starting
// with the queue SCOUT uploads from, which is the one that cannot be wrong.
import { readFileSync, existsSync } from 'node:fs'
import { UPLOAD_MARKET, isUploadMarket } from '../lib/markets'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const r = (p: string) => readFileSync(p, 'utf8')

check('the US store is the upload store', UPLOAD_MARKET === 'amazon.com' && isUploadMarket('amazon.com') && !isUploadMarket('amazon.de') && !isUploadMarket(null))

const QUEUE = r('app/api/global-sync/deliver/queue/route.ts')
check('SCOUT is only ever handed US uploads, whatever is queued', /q = q\.eq\('domain', UPLOAD_MARKET\)/.test(QUEUE))

const DRAIN = r('app/api/cron/coverage-drain/route.ts')
check('other countries are closed with the reason said, before anything else runs',
  /async function retireAbroad/.test(DRAIN) && /reason: UPLOAD_ONLY_REASON/.test(DRAIN) && /detail: UPLOAD_ONLY_REASON/.test(DRAIN)
  && DRAIN.indexOf('await retireAbroad(sb)') < DRAIN.indexOf('const enrolled = await enrol(sb)')
  && DRAIN.indexOf('await retireAbroad(sb)') < DRAIN.indexOf('const audio = await dubs(sb)'))
check('what already happened is left as it was', /not\('state', 'in', '\(uploaded,live,blocked\)'\)/.test(DRAIN) && /is\('delivered_at', null\)/.test(DRAIN))
check('the back catalogue is enrolled for the US store only', /\.eq\('enabled', true\)\.eq\('domain', UPLOAD_MARKET\)/.test(DRAIN))
check('nothing is translated for another country', /\.eq\('domain', UPLOAD_MARKET\)/.test(r('app/api/cron/drain-global-sync/route.ts')))
check('a new sync job takes the US store only', /isUploadMarket\(d\)/.test(r('app/api/global-sync/start/route.ts')))
check('dubbing answers that it is retired, never silently', /status: 410/.test(r('app/api/global-sync/dub/route.ts')))
const MK = r('app/api/coverage/markets/route.ts')
check('Storefront Sync lists and ticks the US store only', /MARKETS\.filter\(\(m\) => isUploadMarket\(m\.domain\)\)/.test(MK) && /enabled && !isUploadMarket\(domain\)/.test(MK))
check('Storefront Sync is retired: the page goes to Liftoff, nothing enrols, and the queue serves only named videos',
  /source: '\/global-sync', destination: '\/liftoff'/.test(r('next.config.ts')) && /if \(SYNC_RETIRED\) return 0/.test(DRAIN)
  && /if \(onlyVideoIds\.length === 0 && !jobId\)/.test(QUEUE) && /syncCells/.test(DRAIN) && /lt\('created_at', graceAgo\)/.test(DRAIN))
check('Liftoff is the US store only too', /LIFTOFF_AMAZON_MARKET = 'amazon\.com'/.test(r('lib/launch-batch.ts')))
check('dub credits are gone: no checkout, no packs, and the webhook credits nothing',
  !existsSync('app/api/stripe/credits-checkout/route.ts') && !existsSync('lib/credit-blocks.ts')
  && !/dub_credits_add/.test(r('app/api/stripe/webhook/route.ts')))
for (const [f, re] of [
  ['app/features/page.tsx', /every Amazon storefront|dubs the video|audio dubbed/],
  ['app/(dashboard)/liftoff/page.tsx', /translates, dubs/],
  ['app/(dashboard)/global-sync/page.tsx', /translating and dubbing/],
] as const) check(`${f} no longer promises other countries or dubs`, !re.test(r(f)))

// DUBS ARE OFF, everywhere (Seb 2026-10-05). One switch, read at every place a
// dub or voice clone could start, and nothing left waiting on one.
{
  const R = (f: string) => readFileSync(f, 'utf8')
  check('the switch is off', /export const DUBS_ENABLED = false/.test(R('lib/markets.ts')))
  check('no speech is synthesized at all', /if \(!DUBS_ENABLED\) return null/.test(R('lib/tts.ts')) && (R('lib/tts.ts').match(/if \(!DUBS_ENABLED\) return false/g) ?? []).length === 2)
  check('no voice is cloned', /if \(!DUBS_ENABLED\) return false/.test(R('lib/voice-clone.ts')) && /if \(!DUBS_ENABLED\) throw new Error/.test(R('lib/voice-clone.ts')) && /if \(!DUBS_ENABLED\) return NextResponse\.json/.test(R('app/api/voice-clone/create/route.ts')))
  check('a dub is refused before any listing is marked dubbing', /if \(!DUBS_ENABLED\) return \{ ok: false, error: UPLOAD_ONLY_REASON, status: 410 \}/.test(R('lib/dub-target.ts')))
  check('the coverage drain blocks with the reason instead of dubbing', /if \(!DUBS_ENABLED\) \{[\s\S]{0,900}state: 'blocked', reason: UPLOAD_ONLY_REASON/.test(R('app/api/cron/coverage-drain/route.ts')))
  check('delivery never holds a market back for a dub', /audioIsMasterFallback: DUBS_ENABLED && !!r\.dub && !r\.video_url/.test(R('app/api/global-sync/deliver/queue/route.ts')))
  check('the Storefront screen offers no dubs', /allowDubbing = DUBS_ENABLED/.test(R('components/launchpad/StorefrontStage.tsx')))
}

if (failures.length) {
  console.error(`\n❌ us-only-uploads: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ us-only-uploads: every Amazon upload goes to the US store, other countries are closed with the reason, nothing is dubbed')
