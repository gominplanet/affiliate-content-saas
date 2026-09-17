// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CAUSE OF THE 186 HOT-LINKED POSTS, NOT THE SYMPTOM.
//
// Measured on 40 hot-linked images taken from the affected posts:
//
//   28 JPEGs   mean  0.20 MB   max  0.37 MB   every one uploaded fine
//   12 PNGs    mean 17.83 MB   max 22.48 MB   every one failed
//
// A perfect split, on sites that were accepting other uploads the same minute.
// I had told Seb three times that these creators' sites were refusing uploads.
// Their sites are fine. Two defects, both ours:
//
//   THE NAME DISAGREES WITH THE BYTES. Every body image is uploaded as
//   `${slug}-body1.jpg` whatever the generator returned, and the first body
//   image of every post is upscaled by fal-ai/aura-sr, which returns PNG.
//   WordPress's wp_check_filetype_and_ext refuses an extension that disagrees
//   with the real type. Deterministic, every host, every time.
//
//   AND THE FILE IS ENORMOUS. 4x on a 1024x768 render is 4096x3072: 15 to 22 MB
//   of PNG, for a picture shown about 700px wide. PHP's default
//   upload_max_filesize is 2 MB.
//
// Three ways a fix here does fresh harm, all pinned below:
//
//   a logo flattened    a PNG with alpha turned into a JPEG gains a black
//                       background, and the sticker and logo paths share this
//                       same upload
//   a GIF killed        resizing an animation silently drops every frame but one
//   a guess for a guess giving an unidentified file an invented extension swaps
//                       one mismatch for another
import {
  planUpload, extensionFor, withExtension, normaliseType, describePlan,
  MAX_UPLOAD_BYTES, MAX_UPLOAD_WIDTH,
} from '../lib/image-upload-prep'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const MB = 1024 * 1024

// ── THE EXACT CASE THAT BROKE 186 POSTS ───────────────────────────────────
{
  // What /api/blog/generate actually passes: a slug-derived .jpg name, and an
  // 18.92 MB PNG that came back from the upscaler.
  const plan = planUpload('garvee-10x10-pop-up-canopy-tent-body1.jpg', {
    contentType: 'image/png',
    byteLength: 18.92 * MB,
  })
  check('it does not go out as it came', plan.action === 'resize', plan.action)
  check('and the name no longer claims to be a JPEG when it is a PNG',
    !plan.filename.endsWith('-body1.jpg') || plan.contentType === 'image/jpeg',
    `${plan.filename} as ${plan.contentType}`)
  check('the extension matches the bytes being sent',
    plan.filename.endsWith('.jpg') === (plan.contentType === 'image/jpeg'),
    `${plan.filename} as ${plan.contentType}`)
  check('and it is brought under a host limit', plan.action === 'resize' && plan.maxWidth === MAX_UPLOAD_WIDTH)
}

// ── the sibling that was fine is left completely alone ────────────────────
{
  const plan = planUpload('garvee-10x10-pop-up-canopy-tent-body2.jpg', {
    contentType: 'image/jpeg',
    byteLength: 0.36 * MB,
  })
  check('a small JPEG is sent as it is', plan.action === 'as-is', plan.action)
  check('and keeps its name', plan.filename === 'garvee-10x10-pop-up-canopy-tent-body2.jpg', plan.filename)
  check('and its type', plan.contentType === 'image/jpeg')
}

// ── a small PNG still gets its name corrected ─────────────────────────────
//
// Size was never the only defect. A 200 KB PNG called .jpg is refused just as
// hard as an 18 MB one.
{
  const plan = planUpload('post-body1.jpg', { contentType: 'image/png', byteLength: 0.2 * MB })
  check('a small PNG is not resized', plan.action === 'as-is', plan.action)
  check('but it IS renamed to match its bytes', plan.filename === 'post-body1.png', plan.filename)
  check('and declared as PNG', plan.contentType === 'image/png')
}

// ── transparency is not thrown away to save bytes ─────────────────────────
{
  const sticker = planUpload('burn-sticker.png', {
    contentType: 'image/png', byteLength: 9 * MB, hasAlpha: true,
  })
  check('a big transparent PNG is still resized', sticker.action === 'resize', sticker.action)
  check('but it stays a PNG', sticker.contentType === 'image/png', sticker.contentType)
  check('and keeps the .png name', sticker.filename.endsWith('.png'), sticker.filename)

  const photo = planUpload('hero.png', {
    contentType: 'image/png', byteLength: 9 * MB, hasAlpha: false,
  })
  check('an opaque PNG becomes a JPEG', photo.contentType === 'image/jpeg', photo.contentType)
  check('and is named .jpg', photo.filename === 'hero.jpg', photo.filename)
}

// ── an animation is never resized ─────────────────────────────────────────
{
  const gif = planUpload('anim.gif', { contentType: 'image/gif', byteLength: 12 * MB })
  check('a big GIF is left alone', gif.action === 'as-is', gif.action)
  check('and keeps its type', gif.contentType === 'image/gif',
    'resizing it here would drop every frame but the first')
}

// ── never invent an extension for something unidentified ──────────────────
{
  // The filename here deliberately does NOT end in .jpg. An earlier version of
  // this block used `mystery.jpg`, so a mutation that invented a .jpg extension
  // produced the identical string and the check saw nothing. A fixture that
  // cannot tell the two apart is not a check.
  for (const ct of [null, '', 'application/octet-stream', 'text/html', 'image/x-weird']) {
    const plan = planUpload('mystery.bin', { contentType: ct, byteLength: 40 * MB })
    check(`an unrecognised type (${ct || 'none'}) is untouched`, plan.action === 'as-is', plan.action)
    check(`and keeps the caller's name (${ct || 'none'})`, plan.filename === 'mystery.bin', plan.filename)
    check(`and no type is invented for it (${ct || 'none'})`,
      plan.contentType !== 'image/jpeg' && plan.contentType !== 'image/png',
      `${plan.contentType}; claiming an unidentified file is a JPEG is the same mismatch in the other direction`)
  }
}

// ── the boundary is a boundary ────────────────────────────────────────────
{
  check('exactly at the limit is sent as it is',
    planUpload('a.jpg', { contentType: 'image/jpeg', byteLength: MAX_UPLOAD_BYTES }).action === 'as-is')
  check('one byte over is resized',
    planUpload('a.jpg', { contentType: 'image/jpeg', byteLength: MAX_UPLOAD_BYTES + 1 }).action === 'resize')
  check('the limit is under PHP\'s 2 MB default with room to spare, and well under 8 MB',
    MAX_UPLOAD_BYTES <= 8 * MB,
    'a limit above what hosts accept fixes nothing')
}

// ── the small helpers ─────────────────────────────────────────────────────
{
  check('a type with parameters still reads', normaliseType('image/png; charset=binary') === 'image/png')
  check('casing does not matter', normaliseType('IMAGE/JPEG') === 'image/jpeg')
  check('a non-image is not an image type', normaliseType('text/html') === null)

  check('jpeg maps to jpg', extensionFor('image/jpeg') === 'jpg')
  check('webp is known', extensionFor('image/webp') === 'webp')
  check('nonsense maps to nothing', extensionFor('image/madeup') === null)

  check('a query string is stripped', withExtension('a/b/c.jpg?x=1', 'png') === 'a/b/c.png')
  check('a name with no extension gains one', withExtension('plain', 'jpg') === 'plain.jpg')
  check('a name with dots keeps them', withExtension('my.post.name.jpeg', 'png') === 'my.post.name.png')
  check('an empty name still produces something', withExtension('', 'jpg') === 'image.jpg')

  const said = describePlan(
    planUpload('x.jpg', { contentType: 'image/png', byteLength: 18.92 * MB }),
    { contentType: 'image/png', byteLength: 18.92 * MB },
  )
  check('the log line names the size', /18\.92 MB/.test(said), said)
  check('and what is being done about it', /resizing/.test(said), said)
}

// ── AND THE UPLOAD PATH ACTUALLY USES IT ──────────────────────────────────
//
// A planner nothing calls leaves all 186 posts exactly where they were.
{
  const strip = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

  const wp = strip(readFileSync('services/wordpress/index.ts', 'utf8'))

  check('the upload path plans before it sends', /planUpload\(filename, \{ contentType, byteLength: buffer\.byteLength \}\)/.test(wp),
    'without this the filename is still whatever the caller guessed')
  check('and sends the planned name and type, not the requested ones',
    /this\.mediaUpload\(buffer, plan\.filename, plan\.contentType\)/.test(wp),
    'planning and then sending the old values is the same bug with extra steps')
  check('it resizes when the plan says to', /\.resize\(\{ width: plan\.maxWidth/.test(wp))
  check('and asks sharp whether there is an alpha channel', /meta\.hasAlpha/.test(wp),
    'without it every transparent PNG over the limit gets a black background')

  // The proxy hands the site a URL and the site fetches it, so it cannot
  // resize. Using it for an oversized image would quietly undo the whole fix.
  check('the proxy is only used when the image needs nothing done to it',
    /if \(headPlan\.action === 'as-is'\) \{[\s\S]{0,200}?tryProxyMediaUploadFromUrl\(imageUrl, headPlan\.filename\)/.test(wp),
    'the proxy cannot resize, so an oversized image must not take that path')

  // The proxy is what makes uploads work on hosts that strip the Authorization
  // header. A source that will not answer a HEAD must not cost those sites
  // their upload path, so that case keeps the behaviour this replaced.
  check('a source that refuses HEAD still gets the proxy, as it always did',
    /\} else \{[\s\S]{0,400}?tryProxyMediaUploadFromUrl\(imageUrl, filename\)/.test(wp),
    'skipping the proxy to be clever about a filename would break the sites it exists for')

  check('a failed resize still fixes the extension', /ext \? withExtension\(filename, ext\) : filename/.test(wp),
    'too big MAY be refused; the wrong extension ALWAYS is, so never give up both')
}

// ── house style ───────────────────────────────────────────────────────────
{
  const lines = [
    describePlan(planUpload('x.jpg', { contentType: 'image/png', byteLength: 18 * MB }), { contentType: 'image/png', byteLength: 18 * MB }),
    describePlan(planUpload('x.jpg', { contentType: 'image/jpeg', byteLength: MB }), { contentType: 'image/jpeg', byteLength: MB }),
  ]
  for (const l of lines) {
    check(`no dash punctuation in "${l.slice(0, 44)}…"`, !/[—–]|\s-\s/.test(l))
    check(`no year in "${l.slice(0, 44)}…"`, !/\b20\d{2}\b/.test(l))
  }
}

if (failures.length) {
  console.error(`\n❌ image-upload-prep: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ image-upload-prep: the filename matches the bytes, and an 18 MB hero is not sent to a shared host')
