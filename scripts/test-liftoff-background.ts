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
check('an open Liftoff page is left to do the work itself', /if \(creatorTabs\.length > 0\) \{ liftoffWake\(5\); return \}/.test(block))
check('a leftover background tab is closed, not taken for the creator\'s page',
  /if \(LIFTOFF_BG_URL\.test\(t\.url \|\| ''\)\)[\s\S]{0,1200}?chrome\.tabs\.remove\(t\.id\)/.test(block))
check('the background tab is pinned and never in front', /active: false, pinned: true/.test(block))
check('a tab that goes quiet is closed', /LIFTOFF_CLOSE_ALARM, \{ delayInMinutes: LIFTOFF_SILENT_MIN \}/.test(block) && /const LIFTOFF_SILENT_MIN = 15\b/.test(block))
check('a tab that says it is alive is kept, up to a cap',
  /msg\.type === 'MVP_LIFTOFF_ALIVE'/.test(BG) && /if \(own && young\) \{ try \{ chrome\.alarms\.create\(LIFTOFF_CLOSE_ALARM/.test(BG))
check('a signed-out or silent run backs off, doubling to two hours',
  /liftoffBackOff\('signed-out'\)/.test(block) && /liftoffBackOff\('timed-out'\)/.test(block) && /Math\.min\(120, 10 \* Math\.pow\(2, misses - 1\)\)/.test(block))
check('SCOUT only ever closes its own tab',
  /const fromOwn = !!senderTab && \(st\.tabId === senderTab\.id \|\| LIFTOFF_BG_URL\.test\(senderTab\.url \|\| ''\)\)/.test(handlers))
check('a restart or update re-arms it', /chrome\.runtime\.onStartup\.addListener\(\(\) => \{ void liftoffResume\(\) \}\)/.test(block)
  && /chrome\.runtime\.onInstalled\.addListener\(\(\) => \{ void liftoffResume\(\) \}\)/.test(block))
check('a closed background tab is forgotten', /chrome\.tabs\.onRemoved\.addListener/.test(block))
{
  const close = block.slice(block.indexOf('async function liftoffCloseOwnTab('), block.indexOf('async function liftoffBackOff('))
  const saveAt = close.indexOf('await liftoffSave({ tabId: null'), removeAt = close.indexOf('chrome.tabs.remove(')
  check('SCOUT forgets its tab before closing it, so its own close is not "the creator closed it"',
    saveAt > -1 && removeAt > -1 && saveAt < removeAt)
}
check('a tab Chrome restored is adopted, not closed mid-run',
  /if \(st\.tabId == null\) \{\s*await liftoffSave\(\{ tabId: t\.id/.test(block)
  && /if \(!own && tab && st\.tabId == null && LIFTOFF_BG_URL\.test\(tab\.url \|\| ''\)\)/.test(BG))
check('switching back on with work left arms it again', /void applyBg\(on, on && workLeft \? 5 : undefined\)/.test(read('components/launch/LaunchBoard.tsx')))
check('merely opening Liftoff does not arm it', /if \(on && typeof msg\.inMinutes === 'number'\)/.test(handlers))
check('an empty fingerprint counts as the same', /\|\| 'empty'/.test(handlers))
{
  const L = BG.indexOf("chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {")
  const first = BG.slice(L, L + 200)
  check('a message with no type is ignored before anything reads it', /=> \{\n  if \(!msg \|\| typeof msg\.type !== 'string'\) return/.test(first))
}
check('stuck work waits longer each time, up to an hour',
  /Math\.min\(60, \(st\.lastWait \|\| 5\) \* 2\)/.test(handlers) && /sig === st\.lastSignature/.test(handlers))
const scan = BG.slice(BG.indexOf('async function scanStudioFinish('), BG.indexOf('async function scanStudioFinish(') + 16000)
check('a background Studio pass opens Studio behind, and does not jump back',
  /active: want\.background !== true/.test(scan) && /callerTabId != null && want\.background !== true/.test(scan))

const RUN = read('components/launch/LiftoffRunner.tsx')
check('the runner never retries a refused listing', /retryFailed: false/.test(RUN))
check('nothing is kept when SCOUT never started or was busy', /fin\.error === 'not-installed' \|\| fin\.error === 'busy'\) \{ more = true; continue \}/.test(RUN))
check('a Studio pass that ran is not run again (the count decides)', /liftoffPending\(\[it\], \[\], pend\)\.studio === 0\) continue/.test(RUN))
check('the runner says it is alive while it works', /setInterval\(\(\) => \{ void liftoffAlive\(\) \}, 120_000\)/.test(RUN))
check('a report that could not be saved is not counted as done', /if \(!pr \|\| !pr\.ok\)/.test(RUN))
check('a failed re-read is not "nothing left"', /if \(!ar\.ok \|\| !a\?\.ok\)/.test(RUN))
check('the page arms SCOUT only when work is left', /if \(!batch \|\| !workLeft \|\| !bgPref/.test(read('components/launch/LaunchBoard.tsx')))
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

// ── a timed-out run goes again, but not for ever ─────────────────────────
const timedOut = (tries: number) => liftoffPending([{ ...base, state: 'scheduled', studio_finish: { ok: false, error: 'timeout', tries }, amazon: [] }], [], { sendToYouTube: true, studioPossible: true })
check('a timed-out Studio run goes again', timedOut(1).studio === 1)
check('but stops after three tries', timedOut(3).studio === 0)
// ── old videos are history, not work ─────────────────────────────────────
const old = liftoffPending([{ ...base, state: 'published', publish_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), studio_finish: null, amazon: [] }],
  ['amazon.de'], { sendToYouTube: true, studioPossible: true })
check('a month-old video is not sent through Studio or Amazon again', old.studio + old.amazon === 0)
const fresh = liftoffPending([{ ...base, state: 'scheduled', publish_at: new Date(Date.now() + 86_400_000).toISOString(), studio_finish: null, amazon: [] }],
  ['amazon.de'], { sendToYouTube: true, studioPossible: true })
check('a video going out tomorrow still is', fresh.studio === 1 && fresh.amazon === 1)

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
