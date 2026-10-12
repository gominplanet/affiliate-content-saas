// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A failed burn says why (Seb, 2026-10-12: "Could not burn the caption:
// [object Object]" on a 3:41 clip). The Cloudinary SDK rejects with plain
// objects, so the reason has to be read out of them, never String(e).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloudErrorText, burnErrorMessage } from '../lib/burn-error'

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
check('the burn route explains the failure', /burnErrorMessage\(getLastOverlayError\(\)\)/.test(read('app/api/instagram/burn/route.ts')))
check('Clip Factory survives a reply that is not JSON', /await res\.json\(\)\.catch\(\(\) => \(\{ error: res\.status === 504/.test(read('components/clip-factory/ClipFactory.tsx')))

if (failed) { console.error(`\n${failed} burn error check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
