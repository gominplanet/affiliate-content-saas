// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A failed burn says why (Seb, 2026-10-12: "Could not burn the caption:
// [object Object]" on a 3:41 clip). The Cloudinary SDK rejects with plain
// objects, so the reason has to be read out of them, never String(e).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloudErrorText, burnErrorMessage, cloudinaryRefusedSize, cloudinaryAccountDown, cloudinaryHandOff } from '../lib/burn-error'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// The shapes the SDK really rejects with (node_modules/cloudinary/lib/uploader.js).
const timeoutShape = { error: { message: 'Request Timeout', http_code: 499, name: 'TimeoutError' } }
const apiShape = { message: 'File size too large. Got 160000000. Maximum is 104857600.', http_code: 400 }
check('a request timeout reads as its message, not [object Object]', cloudErrorText(timeoutShape) === 'Request Timeout (499)', cloudErrorText(timeoutShape))
check('an API error reads as its message', cloudErrorText(apiShape).startsWith('File size too large'), cloudErrorText(apiShape))
check('an Error still reads as its message', cloudErrorText(new Error('boom')) === 'boom')
check('an object with no message is shown as data', cloudErrorText({ foo: 1 }) === '{"foo":1}')
check('nothing never prints [object Object]', ![null, undefined, {}, { error: {} }, timeoutShape, apiShape].some((e) => cloudErrorText(e).includes('[object Object]')))

check('too big says too big and what to do', /too big/.test(burnErrorMessage(cloudErrorText(apiShape))) && /Skip and publish as is/.test(burnErrorMessage(cloudErrorText(apiShape))))
check('an upload timeout says it took too long', /took too long/.test(burnErrorMessage(cloudErrorText(timeoutShape))))
check('a render that never finished says MVP stopped waiting', /stopped waiting/.test(burnErrorMessage('timeout after 120s — last: processing (423)')))
check('anything else passes its reason through', burnErrorMessage('HTTP 400: Invalid transformation') === 'Could not burn the overlay: HTTP 400: Invalid transformation')

const svc = read('services/cloudinary/index.ts')
check('the Cloudinary service never turns an error into String(e)', !/e instanceof Error \? e\.message : String\(e\)/.test(svc) && (svc.match(/cloudErrorText\(e\)/g) || []).length >= 5)
check('the video upload is given longer than the SDK default 60s', /folder: 'ig-overlays',\s*\n\s*timeout: 150_000/.test(svc))
check('the burn route explains the failure', /burnErrorMessage\(cloudReason\)/.test(read('app/api/instagram/burn/route.ts')))
check('Clip Factory survives a reply that is not JSON', /await res\.json\(\)\.catch\(\(\) => \(\{ error: res\.status === 504/.test(read('components/clip-factory/ClipFactory.tsx')))

check('too big and too slow hand over to the render server; a bad transform does not', cloudinaryRefusedSize(cloudErrorText(apiShape)) && cloudinaryRefusedSize(cloudErrorText(timeoutShape)) && cloudinaryRefusedSize('Video is too large to process synchronously') && !cloudinaryRefusedSize('HTTP 400: Invalid transformation'))
const route = read('app/api/instagram/burn/route.ts')
check('a clip Cloudinary refuses, or a long one, burns on MVP\'s render server', /if \(!burnedUrl && \(long \|\| cloudinaryHandOff\(cloudReason\)\)\)/.test(route) && /await renderCta\(videoUrl,/.test(route) && /const LONG_CLIP_SEC = 120/.test(route))
check('the route has time for a render server burn', /export const maxDuration = 600/.test(route))
check('the answer says which burner made it, and the page says so', /\n\s*via,\n/.test(route) && /data\.via === 'render-server'/.test(read('components/clip-factory/ClipFactory.tsx')))
check('the page sends the clip length', /durationSec: clip\.durationSec,/.test(read('components/clip-factory/ClipFactory.tsx')))

// CLOUDINARY SWITCHED OFF (Alejandro, 2026-10-28: "Could not burn the
// overlay: cloud_name is disabled (401)"). The account, not the video: every
// burner hands it to the render server, the member is told it is MVP's side,
// and the team hears once an hour.
const disabled = cloudErrorText({ message: 'cloud_name is disabled', http_code: 401 })
check('a switched-off Cloudinary account is read as MVP\'s side', disabled === 'cloud_name is disabled (401)' && cloudinaryAccountDown(disabled) && cloudinaryHandOff(disabled)
  && cloudinaryAccountDown('Invalid api_key abc') && !cloudinaryAccountDown('HTTP 400: Invalid transformation') && !cloudinaryHandOff('HTTP 400: Invalid transformation'))
check('the member is told it is not their video, with what to do, and no dashes', /on MVP's side, not your video/.test(burnErrorMessage(disabled)) && /Skip and publish as is/.test(burnErrorMessage(disabled)) && !/[–—]| - /.test(burnErrorMessage(disabled)))
check('the team hears about it once an hour, from every Cloudinary failure', /function noteCloudinaryError/.test(svc) && /now - lastDownAlert < 60 \* 60 \* 1000/.test(svc) && (svc.match(/noteCloudinaryError\(/g) || []).length >= 6)
const jobs = read('app/api/cron/process-burn-jobs/route.ts')
check('queued Reel burns go to the render server too, and post what it made', /if \(!burnedUrl && cloudinaryHandOff\(cloudReason\)\) \{\s*\n\s*const out = await renderCta\(job\.source_video_url,/.test(jobs) && /videoUrl: burnedUrl,/.test(jobs) && /result_url: burnedUrl,/.test(jobs) && !/burned\.url/.test(jobs))
check('a queued burn that fails says why in the member\'s words', /throw new Error\(burnErrorMessage\(cloudReason\)\)/.test(jobs))
const blogIg = read('app/api/blog/instagram-post/route.ts')
check('the blog Reel overlay goes to the render server too', /if \(!burnedUrl && cloudinaryHandOff\(getLastOverlayError\(\)\)\) \{\s*\n\s*const out = await renderCta\(effectiveVideoUrl,/.test(blogIg))

if (failed) { console.error(`\n${failed} burn error check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
