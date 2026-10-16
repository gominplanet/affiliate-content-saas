// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PAGE REEL POSTS ITSELF (lib/reel-jobs, migration 435, SCOUT 1.50.0;
// Seb, 2026-10-16: "while meta is processing the video.. mvp is not able to
// post on the facebook page.. are we able to get this done in the background
// like pinned comments on youtube?").
//
// What it holds: the Reel posts once (SCOUT's answer and a pasted link can
// never both post), only with the job's own key, only to a Facebook Group
// post or Reel link, with the same caption the page built (link first, the
// disclaimer, #ad #sponsored, the caption, three clean tags). SCOUT answers
// only MVP's own server, keeps watching for 3 hours, picks the watch back up
// after Chrome puts it to sleep, and says why when there is no link.
import { readFileSync } from 'node:fs'
import { reelDescription, reelLinkOk, hashKey, newKey, MISSED_WORDS } from '../lib/reel-jobs'
import { pageReelCaption } from '../lib/reel-group-caption'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

// ── The caption ──
const d = reelDescription('https://www.facebook.com/groups/gomintech/posts/123456789/', 'If you’re tired of slow smart locks, this changes the game.\n\n#bluetoothlock #smartpadlock #techgadgets #gadget2024 #cooltech #smartpadlocktech #smartsecurity #tested', 'As an Amazon Associate I earn from qualifying purchases.')
const lines = d.split('\n').filter(Boolean)
check('the link is the first line', lines[0] === 'Get it here 👉 https://www.facebook.com/groups/gomintech/posts/123456789/', lines[0])
check('then the disclaimer, then #ad #sponsored', /As an Amazon Associate/.test(lines[1]) && lines[2] === '#ad #sponsored', lines)
const tags = (d.match(/#[A-Za-z][A-Za-z0-9_]*/g) || []).filter((t) => t !== '#ad' && t !== '#sponsored')
check('no year tag, and Facebook’s three', !tags.some((t) => /20\d\d/.test(t)) && tags.length <= 3, tags)
check('the caption is kept', /this changes the game/.test(d))
const reel = pageReelCaption('If you’re tired of slow smart locks, this changes the game.', ['#bluetoothlock', '#smartpadlock', '#techgadgets', '#gadget2024', '#cooltech', '#smartpadlocktech', '#smartsecurity', '#tested'])
const reelTags: string[] = reel.match(/#[A-Za-z][A-Za-z0-9_]*/g) || []
check('the Reel caption MVP fills in has no year tag and at most three', !reelTags.includes('#gadget2024') && reelTags.length <= 3, reelTags)

// ── The link and the key ──
check('a Group post or a Reel link posts; anything else does not', reelLinkOk('https://www.facebook.com/groups/gomintech/posts/123456789/') && reelLinkOk('https://www.facebook.com/reel/1234567890/') && !reelLinkOk('https://evil.example/groups/x/posts/1') && !reelLinkOk('https://www.facebook.com/'))
check('the Group itself only when it is the job’s Group', reelLinkOk('https://www.facebook.com/groups/gomintech', 'https://www.facebook.com/groups/gomintech') && !reelLinkOk('https://www.facebook.com/groups/other', 'https://www.facebook.com/groups/gomintech'))
const k = newKey()
check('the key is long and only its hash is kept', k.length >= 40 && hashKey(k) !== k && hashKey(k) === hashKey(k) && hashKey(k) !== hashKey(newKey()))
check('every way a watch ends without a link has words', ['closed', 'not_seen', 'posted_no_link', 'timeout', 'lost'].every((s) => (MISSED_WORDS[s] || '').length > 20) && !Object.values(MISSED_WORDS).some((w) => /[–—]| - /.test(w)))

// ── Once, and only with the key ──
const LIB = read('lib/reel-jobs.ts')
check('a job is claimed in one conditional update before anything posts', /\.update\(\{ status: 'posting', group_post_url: link[^}]*\}\)\s*\.eq\('id', jobId\)\.in\('status', claimable\)\.select\('\*'\)\.maybeSingle\(\)/.test(LIB) && LIB.indexOf("status: 'posting'") < LIB.indexOf('publishPageReel({'))
const READY = read('app/api/clip-factory/reel-job/ready/route.ts')
check('SCOUT’s answer needs the job’s key', /if \(!row \|\| row\.token_hash !== hashKey\(b\.token\)\) return NextResponse\.json\(\{ error: 'Not this job\.' \}, \{ status: 403 \}\)/.test(READY))
check('SCOUT’s answer posts only a job still waiting, never one moved on by hand', /runReelJob\(admin, id, link, 'post', \['waiting', 'needs_you'\]\)/.test(READY))
check('no link: the job says why and asks for the link', /status: 'needs_you', note: `\$\{note\} Paste the Group post(?:\\u2019|’)s link in Clip Factory, or post the Reel linking to your Group\.`/.test(READY))
const MW = read('middleware.ts')
check('only the keyed answer is open without a session', /'\/api\/clip-factory\/reel-job\/ready',/.test(MW) && !/'\/api\/clip-factory\/reel-job',/.test(MW))
const ROUTE = read('app/api/clip-factory/reel-job/route.ts')
check('the creator’s own actions need their session and their job', /getPublishContext\(await createServerClient\(\)\)/.test(ROUTE) && /\.eq\('id', id\)\.eq\('user_id', user\.id\)\.maybeSingle\(\)/.test(ROUTE))
check('before migration 435 it says so, and the page posts as before', /Posting the Reel in the background needs migration 435\./.test(ROUTE))
const MIG = read('supabase/migrations/435_facebook_reel_jobs.sql')
check('migration 435 is safe to run twice', /create table if not exists public\.facebook_reel_jobs/.test(MIG) && !/create index (?!if not exists)/.test(MIG))

// ── SCOUT ──
const BG = read('extension/background.js')
check('SCOUT answers only the server of the MVP page that asked', /const readyUrl = origin \+ '\/api\/clip-factory\/reel-job\/ready'/.test(BG) && /if \(!\/\^https:\\\/\\\/\(www\\\.\)\?mvpaffiliate\\\.io\$\|\^http:\\\/\\\/localhost:3000\$\/\.test\(origin\)/.test(BG))
check('a handed-off watch runs for 3 hours, not 30 minutes', /const REEL_JOB_HOURS = 3/.test(BG) && /while \(Date\.now\(\) < \(ctx\.until \|\| started \+ 30 \* 60 \* 1000\)\)/.test(BG) && /st\.ctx\.until = \(st\.ctx\.started \|\| Date\.now\(\)\) \+ REEL_JOB_HOURS \* 3600 \* 1000/.test(BG))
check('a minute alarm picks the watch back up after Chrome puts SCOUT to sleep', /chrome\.alarms\.create\(reelJobAlarm\(watchId\), \{ periodInMinutes: 1 \}\)/.test(BG) && /watchGroupPost\(c\.tabId, c\.snippet \|\| '', c\.linkKey \|\| '', \{ id, started: c\.started, until: c\.until, job: c\.job \}\)/.test(BG))
check('however the watch ends, the job hears it', /if \(st\.state !== 'watching' && ctx\.job\) \{[\s\S]{0,140}await reportReelJob\(ctx\.job, st\) \}/.test(BG) && /body = st\.state === 'posted' && st\.url \? \{ id: job\.id, token: job\.token, url: st\.url \} : \{ id: job\.id, token: job\.token, state: st\.state \}/.test(BG))
check('a post that went up before the hand-off is still reported', /\/\/ Already over \(the post went up before MVP handed the job over\): say it now\.\n\s*void reportReelJob\(job, st\)/.test(BG))

// ── The page ──
const PAGE = read('components/clip-factory/ReelDestinations.tsx')
check('the page hands the watch its job and says the tab can be closed', /const jobId = await startReelJob\(res\.watchId\)/.test(PAGE) && /You can close this tab\./.test(PAGE) && /Keep the Facebook tab open until it is up\./.test(PAGE))
check('every way of posting from the page goes through the job once there is one', /if \(jobRef\.current\) \{ await jobManual\(link, how\); return \}/.test(PAGE))
check('an older SCOUT or no migration: the page posts it as before', /if \(h\.state !== 'handed'\) \{/.test(PAGE) && /if \(!j\.ok \|\| !j\.id \|\| !j\.token\) return null/.test(PAGE))

if (fails.length) { console.error('reel-jobs failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ reel-jobs: the Page Reel posts itself once SCOUT sees the Group post, once, with the job’s key, with the caption the page built; MVP’s tab can close')
