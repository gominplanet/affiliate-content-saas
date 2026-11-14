// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A CLIP THAT DID NOT RENDER SAYS WHY, FROM THE RENDERER THAT TRIED (Seb,
// 2026-11-14, two screenshots of Clip Factory's find moments panel):
//   1. "YouTube would not let MVP download this video (it does this
//      sometimes). Upload the video file in the box above once"
//   2. "Couldn't render the clip: cloud_name is disabled"
// 1: Render now has SCOUT bring the creator's own video in from YouTube Studio
// and renders again, as Find Shorts already did. 2: MVP's own render server
// failed, the route fell back to Cloudinary (a switched-off backup), and showed
// Cloudinary's refusal instead of the real reason. Now the render server's
// reason comes first, and a refusing Cloudinary is left alone for an hour.
import { readFileSync } from 'node:fs'
import { clipRenderFailureWords, clipRenderFailureRecord } from '../lib/clip-render-failure'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 400)}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── The words ────────────────────────────────────────────────────────────────
const down = 'cloud_name is disabled (401)'
const seb = clipRenderFailureWords('render service 500: {"error":"ffmpeg: Error opening input file /tmp/rsrc.mp4"}', down)
check('Seb’s case: the render server’s reason is said, Cloudinary’s refusal is not', /MVP's render server said \{"error":"ffmpeg: Error opening input file/.test(seb) && !/cloud_name/.test(seb), seb)
check('a render that ran out of time says so, with what to try', /took longer than its time limit/.test(clipRenderFailureWords('the render timed out', down)) && /Standard instead of Split screen/.test(clipRenderFailureWords('the render timed out', null)))
check('a render killed for memory says so', /ran out of room/.test(clipRenderFailureWords('render service 500: ffmpeg: failed [signal SIGKILL]', null)))
check('a file the render server could not read asks for the video again', /could not read the video file\. Bring the video in again \(Get it from YouTube Studio, or upload it\)/.test(clipRenderFailureWords('render service 500: source download produced no file', null)))
check('a render server not answering says so', /not answering right now/.test(clipRenderFailureWords('render service 502: Bad Gateway', null)))
check('only the backup tried and it is switched off: said plainly', /render server is not set up here, and the backup renderer is switched off/.test(clipRenderFailureWords(null, down)))
const all = [seb, clipRenderFailureWords('the render timed out', null), clipRenderFailureWords(null, down), clipRenderFailureWords(null, 'Invalid clip window.')]
check('every failure says the render was not counted, and ends in a full stop', all.every((t) => /Nothing was used from your monthly renders\.$/.test(t)), all)
check('no dashes in what a creator reads', !all.some((t) => /[–—]| - /.test(t)))
check('the team keeps both renderers’ own words on the clip', clipRenderFailureRecord('the render timed out', down) === 'render server: the render timed out | backup: cloud_name is disabled (401)' && clipRenderFailureRecord(null, null) === 'no reason given')

// ── The route ────────────────────────────────────────────────────────────────
const R = read('app/api/youtube/shorts/render/route.ts')
const prim = R.indexOf('const primaryWhy = !renderedUrl && ingestConfigured() ? getLastIngestError() : null')
const fb = R.indexOf("engine = 'cloudinary'")
check('MVP’s own render reason is kept before the backup runs', prim > 0 && fb > prim)
check('a switched-off Cloudinary is not tried', /if \(!renderedUrl && hasSource && cloudinaryConfigured\(\) && !cloudinaryKnownDown\(\)\) \{/.test(R))
check('both failure answers come from the render server’s reason first', (R.match(/error: clipRenderFailureWords\(/g) || []).length === 2 && !/error: `Couldn't render the clip: \$\{detail\}`/.test(R))
check('a video MVP could not fetch still asks for the file (SCOUT then brings it)', /needsUpload: true, videoId: short\.video_id,\s*\}, \{ status: 412 \}\)/.test(R))
const C = read('services/cloudinary/index.ts')
check('Cloudinary refusing MVP’s account is remembered for an hour', /export function cloudinaryKnownDown\(\): boolean \{ return Date\.now\(\) < accountDownUntil \}/.test(C) && /accountDownUntil = now \+ 60 \* 60 \* 1000/.test(C)
  && C.indexOf('accountDownUntil = now') < C.indexOf('if (now - lastDownAlert < 60 * 60 * 1000) return'))

// ── The Render button ───────────────────────────────────────────────────────
const P = read('components/vertical/ShortsCreatePanel.tsx')
const rc = P.slice(P.indexOf('const renderClip = useCallback'), P.indexOf('const renderClip = useCallback') + 4000)
check('when YouTube refused MVP, Render has SCOUT bring the video in from YouTube Studio and renders again, once',
  /if \(!res\.ok && data\.needsUpload && youtubeVideoId && getFromStudioRef\.current\) \{/.test(rc)
  && /if \(await getFromStudioRef\.current\(\)\) \{ res = await send\(\); data = await safeJson\(res\) \}/.test(rc)
  && rc.indexOf('getFromStudioRef.current()') < rc.indexOf("if (data.needsUpload) { setHasSource(false); setNeedsUpload(true);"))

if (fails.length) { console.error(`❌ clip-render-failure: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ clip-render-failure: Render brings the video in from YouTube Studio when YouTube refused MVP, and a failed render says the render server’s own reason, never a switched-off backup’s')
