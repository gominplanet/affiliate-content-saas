// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE TWEET CARRIES THE PICTURE, AND SAYS SO WHEN IT DOES NOT.
//
// A creator reported his X posts rendering a title, a description and a blank
// grey rectangle. Two separate things were true at once:
//
//   his posts had no featured image, so there was no og:image for X to read.
//   That half is fixed in test-thumbnail-heal.
//
//   and MVP could not attach an image to a tweet AT ALL. createTweet took
//   (accessToken, text) and nothing else, so on every X post ever made by this
//   product the picture was X's rendering of somebody else's web page, or
//   nothing.
//
// THE PART THAT SHAPES EVERY CHECK BELOW. Uploading media under OAuth 2.0 needs
// the `media.write` scope, and a scope is fixed at authorization: refreshing a
// token re-issues the SAME grant. So adding the scope to our request fixes
// nobody who is already connected. Every existing creator keeps a token that
// cannot upload until they reconnect once, and there is no server-side repair.
//
// Which makes "posted, without the image" a normal outcome for a while, and the
// one thing it must never be is a green tick. The failure this guards is not
// "the upload broke" — it is "the upload broke and the screen said Posted."
import { readFileSync } from 'node:fs'
import { mediaCapability, MEDIA_SCOPE } from '../lib/x-scopes'
import { TWITTER_SCOPES } from '../services/twitter'
import {
  sniffImageType, fetchImageForX, resolveXMedia, looksLikeMissingMediaScope, fitForX,
  RECONNECT_FOR_IMAGES, X_IMAGE_MAX_BYTES, X_IMAGE_TYPES, X_DOWNLOAD_MAX_BYTES,
  X_FIT_WIDTHS, X_FIT_QUALITIES,
} from '../lib/x-media'
import sharp from 'sharp'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const SERVICE = readFileSync('services/twitter.ts', 'utf8')
const XMEDIA = readFileSync('lib/x-media.ts', 'utf8')
const POST = readFileSync('app/api/blog/twitter-post/route.ts', 'utf8')
const DEAL = readFileSync('lib/deal-social-publish.ts', 'utf8')
const CRON = readFileSync('app/api/cron/process-scheduled/route.ts', 'utf8')
const CALLBACK = readFileSync('app/api/auth/twitter/callback/route.ts', 'utf8')
const BELL = readFileSync('components/layout/NotificationBell.tsx', 'utf8')
const QUICK = readFileSync('components/deal/QuickPostModal.tsx', 'utf8')
const CONTENT = readFileSync('app/(dashboard)/content/page.tsx', 'utf8')
const SETUP = readFileSync('app/(dashboard)/setup/_components.tsx', 'utf8')

// Comment blocks first, everywhere. Every fix below is explained in a comment
// that quotes the thing it replaced, so a grep over raw source finds the
// EXPLANATION and calls it the bug. test-sales-page-facts flagged its own
// comments on the first run for exactly this reason.
const strip = (s: string) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const service = strip(SERVICE)
const post = strip(POST)
const deal = strip(DEAL)
const cron = strip(CRON)

// ── the scope is requested ─────────────────────────────────────────────────
{
  check('media.write is in the authorization request', TWITTER_SCOPES.includes(MEDIA_SCOPE),
    'without it X refuses every upload, and a creator who reconnects gains nothing')
  check('and the rest of the grant is unchanged',
    ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].every(s => TWITTER_SCOPES.includes(s)),
    'dropping offline.access would silently end every long-lived connection at the next expiry')
}

// ── the capability is a real tri-state ─────────────────────────────────────
//
// 'unknown' is the whole reason this is not a boolean. On the day this ships
// EVERY row has a null scope, and reading null as "cannot post images" would
// show a reconnect warning to every creator on the product, most of whose
// connections are about to be fine. Reading it as "can" would skip the check
// and leave them with silent imageless posts. It is neither, so it is neither.
{
  check('a recorded grant WITH the scope reads yes',
    mediaCapability('tweet.read tweet.write media.write users.read offline.access') === 'yes')
  check('a recorded grant WITHOUT it reads no',
    mediaCapability('tweet.read tweet.write users.read offline.access') === 'no')
  check('an unrecorded grant reads unknown', mediaCapability(null) === 'unknown')
  check('and so does an empty one', mediaCapability('  ') === 'unknown',
    'a blank string is an absent answer, not a denial')
  // The substring trap: 'media.write' must not be matched inside a longer
  // scope name. Split-on-whitespace gets this right; an .includes() would not.
  check('a scope that merely CONTAINS the name does not count',
    mediaCapability('tweet.write not-media.write-really') === 'no',
    'this is why the check splits on whitespace instead of using includes()')
}

// ── the upload is shaped the way X wants ───────────────────────────────────
{
  check('it posts to the v2 media endpoint', /\/2\/media\/upload/.test(service))
  check('as multipart FormData', /new FormData\(\)/.test(service) && /form\.append\('media'/.test(service))
  check('with media_category set', /form\.append\('media_category', 'tweet_image'\)/.test(service),
    'X requires it, and an upload without one is not guaranteed to be post media')
  // The classic multipart bug. Setting Content-Type by hand drops the boundary
  // fetch would have generated, and X cannot split a body it cannot parse.
  const uploadFn = service.slice(service.indexOf('export async function uploadMedia'), service.indexOf('export async function createTweet'))
  check('and NO hand-written Content-Type', !/'Content-Type'/.test(uploadFn),
    'fetch derives it from the FormData along with the multipart boundary; writing it by hand loses the boundary')
  check('the upload gets the upload timeout', /timeoutMs: UPLOAD_TIMEOUT_MS/.test(uploadFn),
    'a 5 MB body on the default 30s budget fails on a slow connection')
  check('the media id comes from data.id', /json\?\.data\?\.id/.test(service))
  check('and a missing id is an error, not an empty attach', /returned no media id/.test(service),
    'returning "" would post a tweet with an empty media_ids array and report success')
  check('the HTTP status survives into the message', /X media upload failed \(\$\{res\.status\}\)/.test(service),
    'lib/x-media reads the status to tell a scope problem from a bad file, and those get different sentences')
}

// ── the tweet attaches them, and only when there are any ───────────────────
{
  check('createTweet takes media ids', /mediaIds\?: string\[\]/.test(service))
  check('and sends X\'s shape', /payload\.media = \{ media_ids: mediaIds \}/.test(service))
  check('an empty list sends no media key at all', /if \(mediaIds && mediaIds\.length\)/.test(service),
    'posting "media": {"media_ids": []} is rejected by X, which would break every text-only post')
}

// ── resolveXMedia NEVER throws ─────────────────────────────────────────────
//
// The single most important property here. An image is an improvement to a
// post; a failed improvement must not cost the creator the post, nor the X cap
// unit the post was about to spend. These call the real function, which is why
// they live in an async block: everything else here is synchronous.
async function liveChecks() {
  // ── an oversized image is RESIZED, not refused ───────────────────────────
  //
  // Real images through the real function. Noise on purpose: a flat colour
  // compresses to nothing and would prove the resize works on the one case
  // that never needed it.
  {
    const w = 2000, h = 1500
    const noise = Buffer.alloc(w * h * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256
    const big = await sharp(noise, { raw: { width: w, height: h, channels: 3 } })
      .png({ compressionLevel: 0 }).toBuffer()
    check('the test image is actually over the limit', big.byteLength > X_IMAGE_MAX_BYTES,
      `${(big.byteLength / 1048576).toFixed(1)} MB`)

    const fitted = await fitForX(new Uint8Array(big), 'image/png')
    check('an oversized image comes back under X\'s limit',
      fitted.bytes.byteLength <= X_IMAGE_MAX_BYTES,
      `${(fitted.bytes.byteLength / 1048576).toFixed(2)} MB`)
    check('and in a format X takes', X_IMAGE_TYPES.has(fitted.contentType))

    // Transparency. JPEG has no alpha and sharp's default fill is BLACK, so a
    // logo on a transparent background becomes a black rectangle on the
    // timeline. Checked on a real pixel rather than on the flatten() call.
    const alpha = await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
      .png().toBuffer()
    const flat = await fitForX(new Uint8Array(alpha), 'image/png')
    const px = await sharp(flat.bytes).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer()
    check('transparency is flattened onto WHITE, not black',
      px[0] > 240 && px[1] > 240 && px[2] > 240, `rgb(${px[0]},${px[1]},${px[2]})`)

    // An animated GIF cannot survive a re-encode. Posting a still frame of
    // something chosen because it moves is worse than saying it did not fit.
    let gifRefused = ''
    try { await fitForX(new Uint8Array(Buffer.alloc(6 * 1024 * 1024)), 'image/gif') }
    catch (e) { gifRefused = e instanceof Error ? e.message : '' }
    check('an oversized GIF is refused rather than flattened to one frame',
      /animation/i.test(gifRefused), gifRefused || 'it was not refused at all')

    // A format X does not accept is converted, not rejected.
    const tiff = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#336699' } }).tiff().toBuffer()
    const conv = await fitForX(new Uint8Array(tiff), 'image/tiff')
    check('a format X does not take is converted', conv.contentType === 'image/jpeg', conv.contentType)
  }

  // No scope → refused without a single network call, so the fake token is
  // never used and this is deterministic offline.
  const noScope = await resolveXMedia({
    accessToken: 'not-a-real-token',
    imageUrl: 'https://example.com/a.jpg',
    grantedScopes: 'tweet.read tweet.write',
  })
  check('a token without media.write is refused without trying',
    noScope.attached === false && noScope.note === RECONNECT_FOR_IMAGES && noScope.mediaIds.length === 0)

  // An SSRF-blocked host: caught inside, returned as a note.
  const blocked = await resolveXMedia({
    accessToken: 'not-a-real-token',
    imageUrl: 'http://127.0.0.1/secret.png',
    grantedScopes: `tweet.write ${MEDIA_SCOPE}`,
  })
  check('an unreachable image comes back as a note, not an exception',
    blocked.attached === false && !!blocked.note && blocked.mediaIds.length === 0,
    'anything thrown here reaches the route\'s catch and marks a post failed that was never attempted')

  // No image asked for is NOT a degraded post and must not carry a warning.
  const none = await resolveXMedia({ accessToken: 't', imageUrl: null, grantedScopes: null })
  check('a post with no image to attach carries no note',
    none.note === null && none.attached === false,
    'warning on a text-only post trains creators to ignore the warning that matters')

  // The SSRF guard is not optional on this path: the image URL comes off a
  // blog row, a deal row or a scraped og:image tag, all ultimately writable.
  let blockedMetadata = false
  try { await fetchImageForX('http://169.254.169.254/latest/meta-data/') } catch { blockedMetadata = true }
  check('the cloud metadata address is refused', blockedMetadata)
}

// ── a refusal is told apart from a bad file ────────────────────────────────
{
  check('a 403 reads as a scope problem', looksLikeMissingMediaScope('X media upload failed (403): ...'))
  check('a 401 does too', looksLikeMissingMediaScope('X media upload failed (401): ...'))
  check('and X\'s own wording', looksLikeMissingMediaScope('You are not permitted to use OAuth2 on this endpoint'))
  check('but a 413 does not', !looksLikeMissingMediaScope('X media upload failed (413): too large'),
    'telling someone to reconnect X because their image is too big sends them to fix the wrong thing')
  check('nor does a plain size message', !looksLikeMissingMediaScope('The image is 9.1 MB and X\'s limit is 5 MB.'))
}

// ── the file is checked before it is sent ──────────────────────────────────
{
  check('the size ceiling is X\'s', X_IMAGE_MAX_BYTES === 5 * 1024 * 1024)
  check('and the accepted types are the ones X takes',
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].every(t => X_IMAGE_TYPES.has(t))
    && !X_IMAGE_TYPES.has('image/svg+xml'),
    'SVG is a script container and X does not accept it as post media')
  check('an image that already fits is passed through untouched',
    /if \(bytes\.byteLength <= X_IMAGE_MAX_BYTES && X_IMAGE_TYPES\.has\(type\)\)/.test(XMEDIA),
    're-encoding a picture that does not need it only loses quality, and turns a transparent PNG opaque for nothing')
  check('content-length is read before the body', /content-length/.test(XMEDIA),
    'an absurd file should be refused by its header, not pulled into a serverless function to be measured')
  check('and the real length is checked again after', /bytes\.byteLength > X_DOWNLOAD_MAX_BYTES/.test(XMEDIA),
    'content-length is advisory; a server that lies about it would otherwise get through')

  // THE BUG THAT SHIPPED. The first real post on this feature had a 5.4 MB
  // hero and was refused outright with "X's limit is 5 MB", which is true and
  // useless: 5.4 MB is a large picture, not an impossible one, and the creator
  // has no way to act on it. The download ceiling exists so the two limits can
  // differ, and everything between them gets resized instead of rejected.
  check('the download ceiling is well above X\'s limit', X_DOWNLOAD_MAX_BYTES > X_IMAGE_MAX_BYTES * 2,
    'if these are the same number, an oversized image is refused and nothing is ever resized')
  // And the one that ROUTES an oversized image into the resize. The live
  // checks below call fitForX directly, so they keep passing while
  // fetchImageForX goes back to throwing — which is exactly the shipped bug.
  check('an image that does not fit is handed to the resize, not thrown',
    /return fitForX\(bytes, type\)/.test(XMEDIA),
    'this line IS the fix; without it fitForX is dead code and a 5.4 MB hero is refused again')
  // The ladder has to descend, or "resize" is one pass at whatever it started
  // at and a big picture still will not fit.
  check('the fit ladder actually steps down',
    X_FIT_WIDTHS.length > 1 && X_FIT_QUALITIES.length > 1
    && X_FIT_WIDTHS.every((w, i, a) => i === 0 || w < a[i - 1])
    && X_FIT_QUALITIES.every((q, i, a) => i === 0 || q < a[i - 1]),
    `widths ${X_FIT_WIDTHS.join('/')}, qualities ${X_FIT_QUALITIES.join('/')}`)
  check('and starts somewhere sensible for a timeline',
    X_FIT_WIDTHS[0] >= 1200 && X_FIT_WIDTHS[0] <= 2048 && X_FIT_QUALITIES[0] >= 75,
    'too small or too soft and every hero posts blurry to fix a problem most of them do not have')

  // Magic-number sniffing, for the servers that send no content-type.
  check('JPEG is recognised', sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === 'image/jpeg')
  check('PNG is recognised', sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) === 'image/png')
  check('GIF is recognised', sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38])) === 'image/gif')
  check('WEBP is recognised',
    sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])) === 'image/webp',
    'the RIFF header alone is not WEBP; bytes 8-11 are the format and have to be read')
  // A RIFF container that is NOT webp (e.g. a wav) must not be called webp.
  check('a non-WEBP RIFF file is not called WEBP',
    sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])) !== 'image/webp')

  check('the SSRF guard is the RESOLVING one', /assertPublicHttpUrlResolved/.test(XMEDIA),
    'the sync guard documents its own gap: a hostname whose A record points at a private IP')
}

// ── all THREE posting paths attach ─────────────────────────────────────────
//
// Wiring one and forgetting another is the likeliest regression here, and the
// symptom would be "images work when I click Post and not when I schedule",
// which is a bug report nobody can act on.
{
  for (const [name, src] of [['manual post', post], ['deal quick-post', deal], ['scheduled cron', cron]] as const) {
    check(`${name} resolves media`, /resolveXMedia\(\{/.test(src))
    // EVERY call site in the file, not "at least one". The cron has two — the
    // first attempt and the 401-retry — and a version of this check that only
    // needed one match passed while the primary call had silently lost its
    // media argument. Which is the whole bug, in the path nobody watches.
    //
    // (The paren dance: the deal path wraps its text in composeText(...), whose
    // own closing paren ends a [^)]* window early, so each call is scanned as a
    // bounded chunk instead.)
    const calls = src.split('createTweet(').slice(1)
    check(`${name} calls createTweet at all`, calls.length > 0)
    const attaching = calls.filter(c => /^[\s\S]{0,250}?[Mm]edia\.mediaIds\s*\)/.test(c))
    check(`${name} passes the ids on EVERY createTweet call`, attaching.length === calls.length,
      `${attaching.length} of ${calls.length} calls attach; resolving media and then not passing it is a silent no-op`)
  }
  // The cron's 401-retry path re-resolves rather than reusing. A 401 on the
  // tweet means the token was dead when the upload ran too, so the first
  // outcome is a scope-shaped note about what was really an expired token.
  check('the cron 401-retry re-resolves the image',
    /accessToken = await doRefresh\(\)\s*\n\s*xMedia = await resolveXMedia/.test(cron),
    'reusing the pre-refresh outcome posts the retry with no picture and blames the wrong thing')
}

// ── and all three REPORT when there is no picture ──────────────────────────
{
  check('the manual route returns a note', /mediaNote: media\.note/.test(post))
  check('named the way the shared modal already reads', /data\.mediaNote/.test(strip(readFileSync('components/content/SocialPreviewModal.tsx', 'utf8'))),
    'the Facebook route set this precedent; a second spelling is a note nothing renders')
  check('the deal path returns a note', /note: xMedia\.note \?\? undefined/.test(deal))
  check('and its result type has somewhere to put it', /note\?: string/.test(deal))
  check('the cron returns one', /note: xMedia\.note \?\? undefined/.test(cron))
  check('and PERSISTS it on the completed row', /error_message: result\.note \?\? null/.test(cron),
    'a note the cron computes and drops is a note nobody will ever see, since nobody is watching an unattended job')
  check('the publishOne signature carries it', /Promise<\{ externalId\?: string; note\?: string \}>/.test(cron))
}

// ── the screens tell the two apart ─────────────────────────────────────────
//
// This is the actual deliverable. "Posted, no image" and "Posted" must not look
// the same, in any of the three places a creator sees the outcome.
{
  const bell = strip(BELL)
  check('the bell shows a message on a COMPLETED row too', !/isFailed && e\.error_message/.test(bell),
    'it used to render the message only on a failure, so a caveat on a successful post had nowhere to appear')
  check('and colours it by status', /isFailed \? '#ff3b30' : '#d97706'/.test(bell),
    'red says the post failed and sends the creator to re-publish something that is already live')
  // Anchored on the icon ternary itself. Slicing a window from the first
  // `isFailed` in the file found an unrelated one and failed on correct code.
  check('the bell icon is not a green tick on a caveat',
    /\?\s*<AlertCircle[^>]*text-\[#ff3b30\][^>]*\/>\s*:\s*e\.error_message/.test(bell),
    'a green tick contradicts the amber sentence underneath it')

  const content = strip(CONTENT)
  check('the queue list colours by status as well', /item\.status === 'completed' \? '#d97706' : '#ff3b30'/.test(content))

  const quick = strip(QUICK)
  check('the deal modal renders the per-platform note', /r\.note && \(/.test(quick))
  check('and does not auto-close over it', /!note && !hasPlatformNote/.test(quick),
    'the modal closed itself 900ms after a clean success, which would hide the warning by design')
}

// ── the reconnect is offered where it can be acted on ──────────────────────
{
  const setup = strip(SETUP)
  check('the X card knows whether it can post images', /mediaCapability\(row\.twitter_scopes/.test(setup))
  check('and only warns on a RECORDED refusal', /!== 'no'/.test(setup),
    'an unknown grant is most creators on day one; warning them all is nagging on a guess')
  check('the warning offers the reconnect', /Reconnect X to post images/.test(SETUP))
  check('and it is gated on being connected', /!twitter\.canPostImages &&/.test(setup),
    'a disconnected card has no grant to be wrong about')
  check('the permission copy mentions the image', /upload the image that goes with it/.test(SETUP),
    'the card promised "only permission to post a single tweet", which is no longer what we ask for')
}

// ── the scope is recorded without risking the token ────────────────────────
//
// The callback carries a comment earned the hard way: PostgREST rejects an
// ENTIRE write over one unknown column, so a column shipped ahead of its
// migration would no-op every connect while every screen still said Connected.
// twitter_scopes is a hint; it must never be able to cost a connection.
{
  check('the callback records what X granted', /rememberXScopes\(supabase, userId, tokens\.scope\)/.test(strip(CALLBACK)))
  check('on its own write, not folded into the token upsert',
    !/twitter_scopes/.test(strip(CALLBACK)),
    'naming it in the upsert means a database without migration 337 saves no tokens at all')
  check('and that write swallows its error', /console\.warn\('\[x-media\] could not record X scopes/.test(XMEDIA),
    'losing the hint is free; losing the connection is not')
  check('a missing hint still tries the upload', /capability === 'no'/.test(strip(XMEDIA)),
    'gating on === "yes" would refuse every pre-337 connection, including the ones that work')
}

// Reported after liveChecks, not alongside it. tsx compiles these scripts to
// CJS, where a top-level await is a syntax error, so the tail is a .then()
// rather than the `await` this would otherwise be.
void liveChecks().catch((e: unknown) => {
  // resolveXMedia rejecting is not an infrastructure problem with this script,
  // it IS the failure being guarded: anything thrown out of that function
  // reaches a posting route's catch and marks a live post failed. Recorded as a
  // named failure rather than left to exit as an unhandled rejection stack.
  failures.push(`resolveXMedia threw instead of returning a note: ${e instanceof Error ? e.message : String(e)}`)
}).then(() => {
  if (failures.length) {
    console.error(`\n❌ x-media: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ x-media: every X post carries its image, and a post that could not is reported as such on every screen that shows it')
})
