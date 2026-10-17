// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT'S QUIET JOBS (SCOUT 1.50.2, lib/scout-quiet; Seb, 2026-10-17: "Make
// sure we don't have any pop-up windows or Scout being brought into the
// foreground while people are trying to work").
//
// What this holds: comment pins, Creator Connections, Amazon videos and
// YouTube Studio can each run in SCOUT's minimized window with the page told
// it is on screen; a job not marked quiet works exactly as before; only an
// admin's tries reach SCOUT; turning a job on for members is one line in MVP;
// and the admin page shows what SCOUT confirmed, not what was clicked.
import { readFileSync } from 'node:fs'
import { QUIET_JOBS, QUIET_FOR_EVERYONE, quietJobsFor } from '../lib/scout-quiet'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── Who decides ──
check('the four jobs, each with what it does and how to test it', QUIET_JOBS.map(j => j.id).join() === 'pin,cc,amazon,studio' && QUIET_JOBS.every(j => j.what.length > 20 && j.test.length > 20 && !/[–—]| - /.test(j.what + j.test)))
check('every job has a setting for members', QUIET_JOBS.every(j => typeof QUIET_FOR_EVERYONE[j.id] === 'boolean'))
const everyone = quietJobsFor(false, null)
check('a member gets the members setting', QUIET_JOBS.every(j => everyone[j.id] === QUIET_FOR_EVERYONE[j.id]))
check('a member’s browser cannot turn a job on', QUIET_JOBS.every(j => quietJobsFor(false, { [j.id]: true })[j.id] === QUIET_FOR_EVERYONE[j.id]))
check('an admin’s try wins over the members setting, either way', quietJobsFor(true, { studio: true }).studio === true && quietJobsFor(true, { pin: false }).pin === false)

// ── SCOUT ──
const BG = read('extension/background.js')
const fnOf = (head: string) => { const i = BG.indexOf(head); return i < 0 ? '' : BG.slice(i, BG.indexOf('\n}\n', i)) }
check('SCOUT keeps which jobs are quiet, and a job is quiet only when MVP said so', /const QUIET_JOBS = \['pin', 'cc', 'amazon', 'studio'\]/.test(BG) && /return quietCache\[job\] === true/.test(BG) && /next\[j\] = !!\(map && map\[j\] === true\)/.test(BG))
check('SCOUT answers with what it now holds', /if \(msg\.type === 'MVP_SCOUT_QUIET'\) \{[\s\S]{0,300}setQuietJobs\(msg\.jobs \|\| \{\}\)\.then\(\(jobs\) => sendResponse\(\{ ok: true, jobs \}\)\)/.test(BG))
check('a quiet tab opens in SCOUT’s own window and the page is told it is on screen', /if \(await quietFor\(job\)\) \{\s*const t = await openWorkTab\(url\)\s*quietTabIds\.add\(t\.id\)/.test(BG) && /Object\.defineProperty\(Document\.prototype, 'visibilityState', \{ configurable: true, get: \(\) => 'visible' \}\)/.test(BG) && /window\.requestAnimationFrame = \(cb\) =>/.test(BG) && /window\.IntersectionObserver = class extends IO/.test(BG))
check('each new page in a quiet tab is told again', /if \(quietTabIds\.has\(tabId\) && \(info\.status === 'loading' \|\| info\.status === 'complete'\)\) void quietShim\(tabId\)/.test(BG))
check('a job not marked quiet opens, comes forward and goes back as before', /return chrome\.tabs\.create\(\{ url, active \}\)/.test(BG) && /await chrome\.tabs\.update\(tabId, \{ active: true \}\)\n\}/.test(BG) && /if \(callerTabId == null \|\| \(await quietFor\(job\)\)\) return/.test(BG))
const jobs: Array<[string, string]> = [
  ['async function pinYouTubeComment(', 'pin'],
  ['async function scanCreatorConnections(', 'cc'], ['async function ccFindCampaign(', 'cc'], ['async function ccSmartScan(', 'cc'], ['async function ccMatchCampaigns(', 'cc'], ['async function acceptCampaignByUrl(', 'cc'], ['async function acceptAndSendBrand(', 'cc'], ['async function sendByCampaignIds(', 'cc'],
  ['async function scanAmazonVideoForeground(', 'amazon'], ['async function readLiveReplay(', 'amazon'], ['async function scanAmazonVideos(', 'amazon'],
  ['async function ytInjectDisclosures(', 'studio'], ['async function scanStudioUpload(', 'studio'], ['async function scanStudioFinish(', 'studio'],
]
const loose = jobs.filter(([h, job]) => {
  const f = fnOf(h)
  if (!f || !new RegExp(`'${job}'`).test(f)) return true
  // No direct way left to the front: every front and back goes through the job.
  return /chrome\.tabs\.update\(callerTabId, \{ active: true \}\)|chrome\.tabs\.create\(\{[^}]*active: true \}\)/.test(f)
}).map(([h]) => h)
check(`every one of the four jobs goes through its quiet switch${loose.length ? ` (not yet: ${loose.join(', ')})` : ''}`, loose.length === 0)
check('Studio upload, quiet: the page is told it is on screen, nothing moves, nothing comes back', /if \(await quietFor\('studio'\)\) \{ quietTabIds\.add\(tabId\); await quietShim\(tabId\); await _sleep\(1500\); return \}/.test(fnOf('async function scanStudioUpload(')) && /if \(!prevTab \|\| prevTab\.id === tabId \|\| \(await quietFor\('studio'\)\)\) return/.test(fnOf('async function scanStudioUpload(')))

// ── MVP ──
const SYNC = read('components/scout/ScoutQuietSync.tsx')
check('MVP tells SCOUT on every dashboard page, and only a SCOUT that knows the message', /<ScoutQuietSync isAdmin=\{isAdmin\} \/>/.test(read('components/layout/DashboardShellV2.tsx')) && /scoutAtLeast\(s\.version, SCOUT_QUIET_MIN_VERSION\)/.test(SYNC) && /SCOUT_QUIET_MIN_VERSION = '1\.50\.2'/.test(read('lib/scout-version.ts')))
check('only an admin’s tries are sent', /quietJobsFor\(isAdmin, readQuietTries\(\)\)/.test(SYNC))
const PAGE = read('app/(dashboard)/admin/scout-quiet/page.tsx')
check('the admin page shows what SCOUT confirmed, and an older or silent SCOUT says so', /SCOUT runs it out of sight/.test(PAGE) && /SCOUT brings it to the front, as before/.test(PAGE) && /did not confirm the change/.test(PAGE) && /These tries need SCOUT \$\{SCOUT_QUIET_MIN_VERSION\}/.test(PAGE) && /SCOUT did not answer in this Chrome/.test(PAGE))
check('the page is in the admin menu', /href: '\/admin\/scout-quiet'/.test(read('components/layout/DashboardShellV2.tsx')))
check('the words on the page have no dashes', !/[–—]/.test((PAGE.match(/>[^<>{}\n]{3,}</g) || []).join(' ') + (PAGE.match(/'[^'\n]{12,}'/g) || []).join(' ')))

if (fails.length) { console.error('scout-quiet failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ scout-quiet: comment pins, Creator Connections, Amazon videos and YouTube Studio can run out of sight when MVP says so; admin tries first, SCOUT confirms')
