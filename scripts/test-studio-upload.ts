// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// LIFTOFF UPLOADS THROUGH SCOUT IN YOUTUBE STUDIO (lib/studio-upload).
//
// An API upload costs 1,600 of the quota every account shares. For a creator
// with this switch on, the server must never upload, SCOUT must never upload
// the same video twice, and each state must read as itself on the board.
import { readFileSync } from 'node:fs'
import { leaveCommentToScout, SCOUT_COMMENT_GRACE_MS, studioDid, scheduleHeld, usesStudioUpload, isStudioWaiting, isStudioRunning, cleanVideoId, studioUploadFailureText, STUDIO_UPLOAD_WAITING, STUDIO_UPLOAD_RUNNING } from '../lib/studio-upload'

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
check('SCOUT saves Private unless MVP asked for a schedule or Public', /: \{ mode: 'private' \}/.test(bg))
check('the file is fetched in SCOUT’s own world', /world: 'ISOLATED', func: studioUploadFileInPage/.test(bg))
check('the kit has the upload text step', /K\.steps\.uploadText/.test(bg))

const manifest = JSON.parse(read('extension/manifest.json'))
const ver = read('lib/scout-version.ts')
check('manifest and SCOUT_LATEST_VERSION agree', ver.includes(`SCOUT_LATEST_VERSION = '${manifest.version}'`))
check('the upload floor is 1.25.0', /SCOUT_STUDIO_UPLOAD_MIN_VERSION = '1\.25\.0'/.test(ver))
check('the runner and the board check the SCOUT floor', /SCOUT_STUDIO_UPLOAD_MIN_VERSION/.test(read('components/launch/LiftoffRunner.tsx')) && /SCOUT_STUDIO_UPLOAD_MIN_VERSION/.test(read('components/launch/LaunchBoard.tsx')))
check('the report names waiting for SCOUT', /Waiting for SCOUT/.test(read('components/launch/LaunchReport.tsx')))

// ── ZERO QUOTA: SCOUT DOES THE REST, THE DRAIN CHECKS IT ─────────────────
check('SCOUT\'s report: only plain true counts', (() => { const d = studioDid({ text: 'yes', tags: true, thumbnail: 1, playlist: false, visibility: 'schedule', publishAt: '2030-01-01T10:00:00Z' }, true); return d.text === null && d.tags === true && d.thumbnail === null && d.playlist === false && d.visibility === 'schedule' })())
check('not saved means no visibility', studioDid({ visibility: 'public' }, false).visibility === null)
check('a schedule with no time is not a schedule', studioDid({ visibility: 'schedule' }, true).visibility === null)
check('a schedule holds only private and at its time', (() => {
  const did = studioDid({ visibility: 'schedule', publishAt: '2030-01-01T10:00:00Z' }, true)
  return scheduleHeld(did, { privacyStatus: 'private', publishAt: '2030-01-01T10:01:00Z' }, '2030-01-01T10:00:00Z')
    && !scheduleHeld(did, { privacyStatus: 'private', publishAt: '2030-01-01T11:00:00Z' }, '2030-01-01T10:00:00Z')
    && !scheduleHeld(did, { privacyStatus: 'public', publishAt: null }, '2030-01-01T10:00:00Z')
    && !scheduleHeld(did, null, '2030-01-01T10:00:00Z')
})())
check('the drain reads what SCOUT did on its own', /select\('id,studio_upload'\)/.test(drain))
check('the drain skips the schedule only when YouTube reads it back', /if \(!goNow && !missed && !heldBack && !studioScheduled\)/.test(drain) && /scheduleHeld\(viaStudio, readBack/.test(drain))
check('the drain skips going public only when YouTube reads it public', /studioPublic = goNow && !heldBack && viaStudio\?\.visibility === 'public' && readBack\?\.privacyStatus === 'public'/.test(drain))
check('unconfirmed paid promotion pulls a SCOUT schedule back to private', /if \(\(!paidConfirmed \|\| missed\) && viaStudio && viaStudio\.visibility && viaStudio\.visibility !== 'private'/.test(drain) && /privacyStatus: 'private', notifySubscribers: notifyByBatch/.test(drain))
check('a thumbnail SCOUT did not set is set by MVP', /viaStudio\?\.thumbnail === true\)/.test(drain) && /yt\.uploadThumbnail\(videoId/.test(drain))
check('a playlist SCOUT did not pick is added by MVP', /if \(viaStudio\?\.playlist !== true\) await yt\.addVideoToPlaylist/.test(drain))
check('title and tags through the API only when SCOUT missed them', /if \(!textOk \|\| \(wantTags\.length > 0 && did\.tags !== true\)\)/.test(route))
check('SCOUT reads back every link in the description', /links\.every\(\(l\) => now\.includes\(l\)\)/.test(bg))
check('SCOUT saves Private when the time has gone', /visibility\.mode = 'private'; delete visibility\.publishAt/.test(bg))
check('SCOUT sets tags, thumbnail and playlist on Details', /K\.steps\.uploadTags/.test(bg) && /K\.steps\.uploadPlaylist/.test(bg) && /func: studioUploadThumbInPage/.test(bg))

// ── FIRST COMMENTS THROUGH SCOUT, THE API ONLY AS A LATE BACKUP ───────────
{
  const now = Date.parse('2030-01-01T12:00:00Z')
  check('a SCOUT creator\'s comment is left to SCOUT within the grace time', leaveCommentToScout(true, '2030-01-01T11:00:00Z', now))
  check('and taken by the API after it', !leaveCommentToScout(true, new Date(now - SCOUT_COMMENT_GRACE_MS - 1000).toISOString(), now))
  check('other creators are never held back', !leaveCommentToScout(false, '2030-01-01T11:00:00Z', now))
  check('a comment with no time is not held back', !leaveCommentToScout(true, null, now))
  const cron = read('app/api/cron/first-comments/route.ts')
  check('the cron leaves SCOUT\'s comments before spending even the 1-unit check',
    cron.indexOf('leaveCommentToScout(') > 0 && cron.indexOf('leaveCommentToScout(') < cron.indexOf('firstCommentDue(r, now)'))
  const sr = read('app/api/youtube/first-comment/scout/route.ts')
  check('SCOUT claims a comment only while it is waiting', /update\(\{ state: 'posting', updated_at: at \}\)\.eq\('id', id\)\.eq\('user_id', user\.id\)\.eq\('state', 'waiting'\)/.test(sr))
  check('a result is written only over SCOUT\'s own claim', (sr.match(/\.eq\('state', 'posting'\)/g) ?? []).length >= 2)
  check('the SCOUT comment route is behind the switch', /usesStudioUpload\(integ\?\.tier\)/.test(sr))
  check('SCOUT posts only as the owner, only on a public video, never twice',
    /studio\.youtube\.com\/video\/' \+ videoId/.test(bg) && /isPrivate === true\) \{ out\.notPublic = true/.test(bg) && /out\.already = true/.test(bg))
  check('SCOUT posts from a tab behind the creator\'s', /watch\?v=' \+ youtubeVideoId, active: false/.test(bg))
  check('Co-Pilot, older videos and Liftoff post before they pin', /await postDueFirstCommentsViaScout\(say\)\.catch/.test(read('lib/first-comment-pins.ts')))
  check('the background tab posts due comments', /postDueFirstCommentsViaScout\(say\)/.test(read('components/launch/LiftoffRunner.tsx')))
}

if (failures.length) {
  console.error('❌ studio upload guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ studio upload guard passed')
