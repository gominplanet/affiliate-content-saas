// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "MY PICTURES DON'T COME UP" IS THREE PROBLEMS WEARING ONE SENTENCE.
//
// A creator with 231 published posts, on a site he had converted from his
// therapy practice to product reviews, asked where to even start. Posts
// publish. Pictures never appear. A second site he built from scratch works.
//
// His own data answered it, and the answer was the one nobody would have
// guessed from the symptom:
//
//   images_status = 'failed'   0 posts
//   images_status = 'ready'   23 posts,  46 images
//   images_status = null     208 posts, 197 images   (predates the column)
//
// Not one upload was ever refused. 243 images are sitting on his site right
// now. The upload path was never the problem; his THEME is not drawing them.
//
// Which is the case that had no name. A creator in that state who is told to
// check security plugins and file permissions will spend a week finding nothing
// wrong, because nothing is wrong there. So the diagnosis has to be able to say
// "your site is fine, look at your theme", and it has to only say that when it
// has actually proved the site is fine.
//
// The three verdicts, and what it costs to confuse them:
//
//   refused    → send them to the theme and they never fix the real block
//   orphaned   → send them to the theme and the file still will not load
//   invisible  → send them to security plugins and they lose a week
import { diagnoseImages, type ImageProbe } from '../lib/wp-image-diagnosis'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

function probe(over: Partial<ImageProbe>): ImageProbe {
  return { uploaded: false, ...over }
}

// ── THE CASE THAT PROMPTED THIS ───────────────────────────────────────────
//
// Upload accepted, file fetched back as a real image. Everything about the
// picture worked, so the site is not the problem.
{
  const d = diagnoseImages(probe({
    uploaded: true,
    mediaUrl: 'https://example.com/wp-content/uploads/x.png',
    mediaFetched: true,
    mediaStatus: 200,
    mediaContentType: 'image/png',
  }))
  check('a working upload that serves is "invisible"', d.verdict === 'invisible', d.verdict)
  check('and it says the site is fine', d.siteAcceptsImages)
  check('and names the theme', /theme/i.test(d.headline), d.headline)
  check('and rules out the wrong hunt explicitly',
    /rules out permissions, security plugins/i.test(d.detail),
    'without this he goes looking through plugins for a fault that is not there')
  check('and tells him where to look instead',
    /featured image/i.test(d.detail), d.detail)
  check('and does NOT suggest reconnecting or permissions',
    !/reconnect|application password/i.test(d.headline), d.headline)
}

// ── refused: the site never took the file ─────────────────────────────────
{
  const perms = diagnoseImages(probe({ uploaded: false, uploadStatus: 403, uploadError: 'rest_cannot_create' }))
  check('a 403 is "refused"', perms.verdict === 'refused', perms.verdict)
  check('and the site is not marked as accepting images', !perms.siteAcceptsImages)
  check('and upload_files is named', /upload_files/.test(perms.detail), perms.detail)
  check('and it does NOT blame the theme', !/theme/i.test(perms.detail),
    'the picture never reached the site, so the theme has nothing to draw')

  const big = diagnoseImages(probe({ uploaded: false, uploadStatus: 413, uploadError: 'Request entity too large' }))
  check('a 413 is about size', /too big|too large/i.test(big.detail), big.detail)
  check('and points at the host', /host/i.test(big.detail), big.detail)

  const noRoute = diagnoseImages(probe({ uploaded: false, uploadStatus: 404, uploadError: 'rest_no_route' }))
  check('a missing route is named as the REST API', /rest api/i.test(noRoute.detail), noRoute.detail)

  const boom = diagnoseImages(probe({ uploaded: false, uploadStatus: 500, uploadError: 'PHP fatal' }))
  check('a 500 points at the server, not the creator',
    /server rather than at permissions/i.test(boom.detail), boom.detail)

  // Every refusal, however odd, still produces something actionable.
  for (const [status, err] of [[400, 'weird'], [null, ''], [418, 'teapot']] as const) {
    const d = diagnoseImages(probe({ uploaded: false, uploadStatus: status, uploadError: err }))
    check(`a ${status} refusal still says something useful`, d.detail.length > 60, d.detail)
    check(`a ${status} refusal is still "refused"`, d.verdict === 'refused')
  }
}

// ── orphaned: stored, but the web cannot fetch it ─────────────────────────
{
  const d = diagnoseImages(probe({
    uploaded: true, mediaUrl: 'https://example.com/x.png', mediaFetched: false, mediaStatus: 403,
  }))
  check('stored but unfetchable is "orphaned"', d.verdict === 'orphaned', d.verdict)
  check('and it does NOT send him to the theme', !/theme/i.test(d.detail),
    'the file will not load at all; the theme cannot fix that')
  check('and it does not claim the upload failed', d.siteAcceptsImages)

  const html = diagnoseImages(probe({
    uploaded: true, mediaUrl: 'https://example.com/x.png',
    mediaFetched: false, mediaStatus: 200, mediaContentType: 'text/html; charset=utf-8',
  }))
  check('an HTML body served for an image is called out', /web page instead of a picture/i.test(html.detail), html.detail)
  check('and points at what sits in front of uploads', /uploads/i.test(html.detail), html.detail)
}

// ── unknown: accepted, and we did not get to check ────────────────────────
//
// Its own verdict on purpose. Folding it into "invisible" would tell a creator
// his site is proven fine on the strength of a check that never ran, which is
// the failure this whole file exists to prevent.
{
  const d = diagnoseImages(probe({ uploaded: true, mediaUrl: null, mediaFetched: null }))
  check('unchecked is its own verdict', d.verdict === 'unknown', d.verdict)
  check('and says so plainly', /could not check/i.test(d.headline), d.headline)
  check('and calls itself half an answer', /half an answer/i.test(d.detail), d.detail)
  check('and does not name the theme', !/theme/i.test(d.detail),
    'that conclusion requires the serve check to have passed')
  check('but still credits what DID work', d.siteAcceptsImages && /upload itself worked/i.test(d.detail), d.detail)
}

// ── the verdicts never overlap ────────────────────────────────────────────
//
// Cheap, and it is the property the whole feature rests on: one probe, one
// answer.
{
  const cases: Array<[string, ImageProbe]> = [
    ['refused', probe({ uploaded: false, uploadStatus: 403 })],
    ['invisible', probe({ uploaded: true, mediaFetched: true, mediaStatus: 200, mediaContentType: 'image/png' })],
    ['orphaned', probe({ uploaded: true, mediaFetched: false, mediaStatus: 404 })],
    ['unknown', probe({ uploaded: true, mediaFetched: null })],
  ]
  const seen = new Set<string>()
  for (const [expected, p] of cases) {
    const d = diagnoseImages(p)
    check(`${expected} resolves to itself`, d.verdict === expected, d.verdict)
    check(`${expected} has not been produced by another probe`, !seen.has(d.verdict))
    seen.add(d.verdict)
    check(`${expected} has a headline and a detail`, d.headline.length > 10 && d.detail.length > 40)
  }
  check('all four verdicts are reachable', seen.size === 4, [...seen].join(', '))
}

// ── house style ───────────────────────────────────────────────────────────
{
  const all = [
    diagnoseImages(probe({ uploaded: false, uploadStatus: 403 })),
    diagnoseImages(probe({ uploaded: false, uploadStatus: 413 })),
    diagnoseImages(probe({ uploaded: true, mediaFetched: true, mediaContentType: 'image/png' })),
    diagnoseImages(probe({ uploaded: true, mediaFetched: false, mediaStatus: 403 })),
    diagnoseImages(probe({ uploaded: true, mediaFetched: null })),
  ]
  for (const d of all) {
    for (const s of [d.headline, d.detail]) {
      check(`no dash punctuation in "${s.slice(0, 36)}…"`, !/[—–]|\s-\s/.test(s))
      check(`no year in "${s.slice(0, 36)}…"`, !/\b20\d{2}\b/.test(s))
    }
  }
}

// ── AND THE STATUS THAT SENT THE INVESTIGATION THE WRONG WAY ──────────────
//
// This is the part that actually cost time. His rows read:
//
//   images_status = 'failed'   0 posts
//   images_status = 'ready'   23 posts
//
// which says the upload path is healthy. It was not. Every picture in those 23
// posts was pointing at the URL MVP generated it from, because his site refused
// the upload and the fallback counted as a success. His live site settles it:
// 45 pictures hosted on his own domain in July, none in August, none in
// September, and featured images (which REQUIRE an upload) went 73/83 in July
// to 0/25 in September.
//
// So 'ready' now means every picture is on the creator's site, and the
// in-between state has a name of its own. Checked on the source, because the
// bug was in what the route WROTE, not in anything a pure function returns.
{
  const src = readFileSync('app/api/blog/generate/route.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

  check('a hosted upload is told apart from a fallback', /hosted: true/.test(src) && /hosted: false/.test(src),
    'without this the two are the same value and the status cannot distinguish them')
  // Anchored per branch. There are TWO image paths, the creator's own uploads
  // and the AI-generated ones, and the first version of this check was
  // satisfied by literals in whichever branch still had them. The AI path is
  // the one that matters most here: every picture in the case that prompted
  // this was AI-generated and pointing at the generation CDN.
  check('the AI path derives hosted from the actual upload result',
    /hosted: !!mediaUrl/.test(src),
    'hardcoding it true there marks every fallback as hosted, which is the defect wearing a new name')
  check('and the creator-upload path derives it from the media response',
    /media\?\.source_url\s*\?\s*\{ url: media\.source_url, alt: altFor\(i\), hosted: true \}/.test(src))
  check('and the hosted ones are counted', /uploaded\.filter\(u => u\.hosted\)/.test(src))
  check("'ready' requires ALL of them to be hosted",
    /hostedCount === uploaded\.length \? 'ready'/.test(src),
    "any looser and a site refusing every upload reports a clean run, which is what happened")
  check('the in-between state has its own name', /'hotlinked'/.test(src),
    'folding it into ready hides it; folding it into failed hides that the post is fine to read today')
  check('and the old always-ready test is gone',
    !/images_status: uploaded\.length > 0 \? 'ready' : 'failed'/.test(src),
    'that expression is true whenever anything was attempted, which is the defect')

  check('the migration exists', (() => {
    try { return readFileSync('supabase/migrations/339_blog_images_hosted_count.sql', 'utf8').includes('images_hosted_count') } catch { return false }
  })())
  check('and the write survives the column being absent', /images_hosted_count arrives with migration 339/.test(readFileSync('app/api/blog/generate/route.ts', 'utf8')),
    'between the deploy and the migration the status must still be recorded')
}

if (failures.length) {
  console.error(`\n❌ image-diagnosis: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ image-diagnosis: refused, orphaned, invisible and unchecked are four different answers')
