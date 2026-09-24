// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Liftoff keeps going when its page is closed, and only ever the way it was
// asked to.
//
// WHY THIS EXISTS. After Launch, the Amazon uploads and the Studio-only
// settings need the creator's own Chrome (SCOUT, signed in as them), and they
// ran only while the Liftoff page was open. SCOUT now wakes itself with an
// alarm and, when no Liftoff tab is open, opens one pinned in the background
// that finishes every launched batch and tells SCOUT when it is done.
//
// What must never happen: a Studio tab jumping in front of whatever the
// creator is doing, the background run retrying things that failed, SCOUT
// closing a tab the creator opened, a tab reopening every five minutes for
// ever over work that is stuck, or another site switching it on.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { liftoffPending } from '../lib/liftoff-pending'
import { SCOUT_LATEST_VERSION } from '../lib/scout-version'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const root = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const M = JSON.parse(read('extension/manifest.json'))
check('SCOUT can set alarms', (M.permissions ?? []).includes('alarms'))
// ALARMS IS THE ONLY NEW PERMISSION, and it carries no install warning. A
// permission with a warning makes Chrome switch SCOUT off on update until each
// creator approves it again, which would stop every Amazon upload at once.
const APPROVED = ['activeTab', 'scripting', 'storage', 'tabs', 'downloads', 'alarms']
check('and no other permission was added', JSON.stringify([...(M.permissions ?? [])].sort()) === JSON.stringify([...APPROVED].sort()),
  `permissions are ${JSON.stringify(M.permissions)}`)
check('the manifest and the app agree on the version', M.version === SCOUT_LATEST_VERSION, `${M.version} vs ${SCOUT_LATEST_VERSION}`)

const BG = read('extension/background.js')
const block = BG.slice(BG.indexOf('// ── LIFTOFF IN THE BACKGROUND'), BG.indexOf('chrome.runtime.onMessageExternal.addListener'))
const handlers = BG.slice(BG.indexOf("msg.type === 'MVP_LIFTOFF_AUTO'"), BG.indexOf("msg.type === 'MVP_LIFTOFF_DONE'") + 1600)
check('only MVP can switch it on', /if \(!LIFTOFF_ORIGINS\.test\(origin\)\)/.test(handlers) && /mvpaffiliate\\\.io/.test(block))
check('an open Liftoff page is left to do the work itself', /if \(open\.length > 0\) \{ liftoffWake\(5\); return \}/.test(block))
check('the background tab is pinned and never in front', /active: false, pinned: true/.test(block))
check('a tab that never reports back is closed', /LIFTOFF_CLOSE_ALARM, \{ delayInMinutes: 45 \}/.test(block))
check('a signed-out run is closed and remembered', /liftoffCloseOwnTab\('signed-out'\)/.test(block))
check('SCOUT only ever closes its own tab', /const fromOwn = sender && sender\.tab && st\.tabId === sender\.tab\.id/.test(handlers))
check('stuck work waits longer each time, up to an hour',
  /Math\.min\(60, \(st\.lastWait \|\| 5\) \* 2\)/.test(handlers) && /sig === st\.lastSignature/.test(handlers))
const scan = BG.slice(BG.indexOf('async function scanStudioFinish('), BG.indexOf('async function scanStudioFinish(') + 9000)
check('a background Studio pass opens Studio behind, and does not jump back',
  /active: want\.background !== true/.test(scan) && /callerTabId != null && want\.background !== true/.test(scan))

const RUN = read('components/launch/LiftoffRunner.tsx')
check('the runner never retries a refused listing', /retryFailed: false/.test(RUN))
check('nothing is kept when SCOUT never started or was busy', /fin\.error === 'not-installed' \|\| fin\.error === 'busy'\) \{ more = true; continue \}/.test(RUN))
check('a Studio pass that ran is not run again', /if \(it\.studio_finish && it\.studio_finish\.error !== 'timeout'\) continue/.test(RUN))
check('it asks the same request builder as the page', /liftoffStudioRequest\(it, opts, notify, true\)/.test(RUN)
  && /liftoffStudioRequest\(it, studioOpts, notifySubs\)/.test(read('components/launch/LaunchBoard.tsx')))
check('it always tells SCOUT when it is finished', /await liftoffDone\(more, sigs\.join\('#'\)\)/.test(RUN))
check('the page sends SCOUT\'s background tab to the runner', /if \(sp\.background === '1'\) return <LiftoffRunner \/>/.test(read('app/(dashboard)/liftoff/page.tsx')))
check('the creator can switch it off', /toggleBg\(!bgPref\)/.test(read('components/launch/LaunchBoard.tsx')))

// ── what counts as still to do ───────────────────────────────────────────
const base = { id: 'a', youtube_video_id: 'yt1', video_id: 'v1', studio_finish: { ok: true } }
const done = liftoffPending([{ ...base, state: 'scheduled', amazon: [{ domain: 'amazon.de', state: 'delivered' }, { domain: 'amazon.fr', state: 'failed' }, { domain: 'amazon.it', state: 'grid:blocked' }] }],
  ['amazon.de', 'amazon.fr', 'amazon.it'], { sendToYouTube: true, studioPossible: true })
check('listed, failed and not-sold are finished', done.youtube + done.studio + done.amazon === 0)
const dub = liftoffPending([{ ...base, state: 'scheduled', amazon: [{ domain: 'amazon.de', state: 'localized', waitingOnDub: true }] }],
  ['amazon.de'], { sendToYouTube: true, studioPossible: true })
check('a dub still rendering is not', dub.amazon === 1)
const late = liftoffPending([{ id: 'b', state: 'prepared', planned_publish_at: null, youtube_video_id: null }], ['amazon.de'], { sendToYouTube: true, studioPossible: true })
check('a video waiting for the creator is not background work', late.youtube + late.amazon === 0)
const amzOnly = liftoffPending([{ id: 'c', state: 'amazon_only', youtube_video_id: null, video_id: 'v', amazon: [] }], ['amazon.de'], { sendToYouTube: false, studioPossible: true })
check('an Amazon-only video is reachable without YouTube, and has no Studio pass', amzOnly.amazon === 1 && amzOnly.studio === 0)
const noRun = liftoffPending([{ ...base, state: 'scheduled', studio_finish: null, amazon: [] }], [], { sendToYouTube: true, studioPossible: true })
check('a video with no Studio pass yet is', noRun.studio === 1)

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
