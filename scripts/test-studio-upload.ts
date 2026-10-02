// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIFTOFF UPLOADS THROUGH SCOUT IN YOUTUBE STUDIO (lib/studio-upload).
//
// An API upload costs 1,600 of the quota every account shares. For a creator
// with this switch on, the server must never upload, SCOUT must never upload
// the same video twice, and each state must read as itself on the board.
import { readFileSync } from 'node:fs'
import { usesStudioUpload, isStudioWaiting, isStudioRunning, cleanVideoId, studioUploadFailureText, STUDIO_UPLOAD_WAITING, STUDIO_UPLOAD_RUNNING } from '../lib/studio-upload'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

check('admin only while tested', usesStudioUpload('admin') && !usesStudioUpload('pro') && !usesStudioUpload('free'))
check('waiting note reads as waiting', isStudioWaiting(STUDIO_UPLOAD_WAITING) && /^Waiting/.test(STUDIO_UPLOAD_WAITING))
check('running note is running', isStudioRunning(`${STUDIO_UPLOAD_RUNNING} Try 1 of 3.`) && !isStudioWaiting(STUDIO_UPLOAD_RUNNING))
check('a YouTube id is 11 characters', cleanVideoId('dQw4w9WgXcQ') === 'dQw4w9WgXcQ' && cleanVideoId('abc') === null && cleanVideoId('<script>xx') === null)
check('upload limit reads as waiting', /^Waiting/.test(studioUploadFailureText('upload-limit', '')) && /own daily upload limit/.test(studioUploadFailureText('upload-limit', '')))
check('an unknown failure keeps its words', /went wrong here/.test(studioUploadFailureText('x', 'went wrong here')))
check('no em or en dashes in the words', ![STUDIO_UPLOAD_WAITING, STUDIO_UPLOAD_RUNNING, ...['wrong-channel', 'upload-limit', 'timeout', 'not-sent', 'no-picker', 'file-http-404', 'x'].map((e) => studioUploadFailureText(e, ''))].some((t) => /[\u2013\u2014]| - /.test(t)))

const drain = read('app/api/cron/launch-drain/route.ts')
const gate = drain.indexOf('usesStudioUpload(await ownerTier(')
check('the drain leaves Studio uploads to SCOUT', gate > 0)
check('the gate comes before the claim and the upload', gate > 0 && gate < drain.indexOf('publish_tries: tries + 1,') && gate < drain.indexOf('yt.uploadShort('))
check('the gate only covers rows with no video yet', /if \(!String\(it\.youtube_video_id \|\| ''\)\.trim\(\) && usesStudioUpload/.test(drain))
check('waiting rows cannot crowd out the rest', /\.limit\(PUBLISHES \* 4 \+ 40\)/.test(drain))

const route = read('app/api/launch/studio-uploads/route.ts')
check('the route is behind the switch', /usesStudioUpload\(integ\?\.tier\)/.test(route))
check('a claim is guarded on the try count', /q\.eq\('publish_tries', tries\)/.test(route) && /q\.is\('publish_tries', null\)/.test(route))
check('the id is written only where there is none', /youtube_video_id: videoId,[\s\S]{0,300}\.is\('youtube_video_id', null\)/.test(route))
check('a second copy is named, not hidden', /is a second one: delete it in Studio/.test(route))
check('an unsaved draft stops before any time is set', /r\.saved !== true/.test(route) && /state: 'blocked'/.test(route))
check('a wrong channel stops at once', /wrong-channel/.test(route))
check('rows are scoped to the signed-in creator', /\.eq\('user_id', user\.id\)\.eq\('state', 'prepared'\)/.test(route) && /\.eq\('id', itemId\)\.eq\('user_id', user\.id\)/.test(route))

const bg = read('extension/background.js')
check('SCOUT handles MVP_STUDIO_UPLOAD', /msg\.type === 'MVP_STUDIO_UPLOAD'/.test(bg))
check('SCOUT answers a repeat with the id it kept', /already: true, videoId: map\[o\.itemId\]\.videoId/.test(bg))
check('SCOUT waits for the whole file before saving', bg.indexOf("step: 'sending', ok: true") > 0 && bg.indexOf("step: 'sending', ok: true") < bg.indexOf('const draftSteps = await runStudioDraft(tabId, videoId, want)'))
check('SCOUT saves Studio uploads as private', /visibility: \{ mode: 'private' \}/.test(bg))
check('the file is fetched in SCOUT’s own world', /world: 'ISOLATED', func: studioUploadFileInPage/.test(bg))
check('the kit has the upload text step', /K\.steps\.uploadText/.test(bg))

const manifest = JSON.parse(read('extension/manifest.json'))
const ver = read('lib/scout-version.ts')
check('manifest and SCOUT_LATEST_VERSION agree', ver.includes(`SCOUT_LATEST_VERSION = '${manifest.version}'`))
check('the upload floor is 1.25.0', /SCOUT_STUDIO_UPLOAD_MIN_VERSION = '1\.25\.0'/.test(ver))
check('the runner and the board check the SCOUT floor', /SCOUT_STUDIO_UPLOAD_MIN_VERSION/.test(read('components/launch/LiftoffRunner.tsx')) && /SCOUT_STUDIO_UPLOAD_MIN_VERSION/.test(read('components/launch/LaunchBoard.tsx')))
check('the report names waiting for SCOUT', /Waiting for SCOUT/.test(read('components/launch/LaunchReport.tsx')))

if (failures.length) {
  console.error('❌ studio upload guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ studio upload guard passed')
