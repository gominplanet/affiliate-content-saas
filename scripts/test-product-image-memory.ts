// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One approved image per product, recalled across surfaces — and every rule
// that keeps the recall honest.
//
// The measurement that shaped this, kept here so nobody rebuilds it as a cache:
//
//   product_touches 182 | distinct_products 165 | avg_touches_per_product 1.10
//   total image spend across every product feature, 90 days: $1.44
//
// At 1.10 touches there is no money in caching generated images, and the
// decision rule was named BEFORE the query ran. What this feature is actually
// for is recall: an image the creator UPLOADED cannot be regenerated (Co-Pilot
// used to read it into a data URI and drop it), and one product should look
// like one product across YouTube, Facebook and Pinterest.
//
// Which makes the failure mode obvious: a composer that silently posts an old
// image looks exactly like one that made a fresh one. So the tests below are
// mostly about SAYING SO.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { reuseLabel, daysBetween, isAsin, STALE_AFTER_DAYS } from '../lib/product-image-label'
import { normalizeForStorage } from '../lib/product-image-normalize'
import { MAX_IMAGE_BYTES, extForMime, isAllowedImageMime } from '../lib/product-image-limits'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const NOW = new Date('2026-09-15T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

// ── the label says which image, from where, from when ───────────────────────
{
  const l = reuseLabel({ source: 'generated', surface: 'YouTube Co-Pilot', approvedAt: daysAgo(1) }, NOW)
  check('names the surface', l.text.includes('YouTube Co-Pilot'), l.text)
  check('names the date', /Sep\s+14/.test(l.text), l.text)
  check('a fresh image carries no warning', l.note === null && !l.stale, String(l.note))

  const up = reuseLabel({ source: 'upload', surface: 'YouTube Co-Pilot', approvedAt: daysAgo(1) }, NOW)
  check('an uploaded image is called the creator’s own',
    up.text.includes('your own image'),
    `"${up.text}" — an upload is the one image regenerating can never reproduce, so it must not read as something MVP made`)
  check('a generated image is not called their own',
    l.text.includes('your thumbnail') && !l.text.includes('your own image'), l.text)
}

// ── NO YEAR. anywhere. ever. ────────────────────────────────────────────────
//
// The standing rule, and the one a date label is most likely to break: a
// toLocaleDateString with the wrong options, or a "(2026)" helpfully appended
// for an older image.
{
  for (const d of [0, 1, 45, 120, 400, 900]) {
    const l = reuseLabel({ source: 'generated', surface: 'Facebook', approvedAt: daysAgo(d) }, NOW)
    const joined = `${l.text} ${l.note ?? ''}`
    check(`no year in the label at ${d} days old`, !/\b(19|20)\d{2}\b/.test(joined),
      `"${joined}" — the year never appears in generated copy, and an old image is described in words instead`)
  }
}

// ── an old image is offered, but says how old ───────────────────────────────
{
  const fresh = reuseLabel({ source: 'generated', surface: 'Facebook', approvedAt: daysAgo(STALE_AFTER_DAYS - 1) }, NOW)
  const old = reuseLabel({ source: 'generated', surface: 'Facebook', approvedAt: daysAgo(STALE_AFTER_DAYS + 1) }, NOW)
  check('just under the threshold stays quiet', !fresh.stale && fresh.note === null)
  check('just over the threshold speaks up', old.stale && !!old.note, String(old.note))
  check('and says roughly how old in words', /month/.test(old.note ?? ''), String(old.note))
  check('a year-old image does not read as 1 month',
    /\b(12|13)\s+months/.test(reuseLabel({ source: 'generated', surface: null, approvedAt: daysAgo(370) }, NOW).note ?? ''),
    reuseLabel({ source: 'generated', surface: null, approvedAt: daysAgo(370) }, NOW).note ?? '')
}

// ── the label never crashes a composer ──────────────────────────────────────
{
  const bad = reuseLabel({ source: 'generated', surface: null, approvedAt: 'not-a-date' }, NOW)
  check('a junk timestamp degrades to words', bad.text.includes('earlier') && !bad.text.includes('Invalid'), bad.text)
  check('and days between junk is 0, not NaN', daysBetween('nope', NOW) === 0, String(daysBetween('nope', NOW)))
  check('a future timestamp is not negative days', daysBetween(daysAgo(-30), NOW) === 0)
}

// ── the key ────────────────────────────────────────────────────────────────
{
  check('a real ASIN is accepted', isAsin('B07XJ8C8F5'))
  check('lowercase is accepted (callers upper-case it)', isAsin('b07xj8c8f5'))
  check('a short string is not an ASIN', !isAsin('B07XJ8'))
  check('a URL is not an ASIN', !isAsin('https://www.amazon.com/dp/B07XJ8C8F5'))
  check('null is not an ASIN', !isAsin(null))
}

// ── the browser can render the label ────────────────────────────────────────
//
// lib/product-image-memory is server-only. If the label helpers move back into
// it, every composer that imports them breaks at build time — in a way that
// looks like a bundler problem rather than this decision.
{
  const LABEL = readFileSync('lib/product-image-label.ts', 'utf8')
  check('the label module is not server-only', !/^\s*import 'server-only'/m.test(LABEL),
    'the composers are client components and import it directly')
  const MEM = readFileSync('lib/product-image-memory.ts', 'utf8')
  check('the server module still is', /import 'server-only'/.test(MEM))
  check('and does not redefine the label', !/export function reuseLabel/.test(MEM),
    're-export it instead, so the server and the screen cannot disagree about the words')
}

// ── the client never hands the server an image URL to post ──────────────────
//
// The quick-post endpoint publishes to the creator's real social accounts. It
// resolves the saved image from (user, asin) itself; accepting a URL from the
// browser would turn it into an arbitrary-image publisher.
{
  const MODAL = readFileSync('components/deal/QuickPostModal.tsx', 'utf8')
  check('the modal sends a flag', /useSavedImage/.test(MODAL))
  check('and not the saved URL', !/imageOverride:\s*saved/.test(MODAL) && !/imageOverride,/.test(MODAL),
    'the server looks the image up itself')

  const ROUTE = readFileSync('app/api/deal-radar/social-post/route.ts', 'utf8')
  check('the route resolves it server-side', /recallProductImage\(supabase, user\.id, asin\)/.test(ROUTE))
  check('gated on the flag being exactly true', /body\.useSavedImage === true/.test(ROUTE),
    'a truthy string from a hand-rolled request should not switch this on')
  check('and reports which image it used', /usedSavedImage/.test(ROUTE),
    'asking to reuse when nothing is saved falls back silently otherwise')
}

// ── what the modal promised is what fires ───────────────────────────────────
//
// A deal post scheduled on Monday fires on Thursday. If the cron re-resolved
// the saved image at fire time it would pick up anything approved in between,
// and the line the creator read while scheduling ("Reusing your thumbnail from
// Sep 14") would describe an image that never went out.
{
  const ROUTE = readFileSync('app/api/deal-radar/social-post/route.ts', 'utf8')
  check('the chosen image is stored on the queued row', /image_override: imageOverride/.test(ROUTE))

  const CRON = readFileSync('app/api/cron/process-deal-schedules/route.ts', 'utf8')
  check('the cron posts the stored image', /imageOverride: row\.image_override/.test(CRON))
  check('the cron does not re-resolve it', !/recallProductImage/.test(CRON),
    'resolving again at fire time would silently swap in a newer image')
}

// ── a reused image is posted as-is ──────────────────────────────────────────
//
// buildDealCardImage paints a deal hook over the product photo. Painting it
// over art the creator designed themselves wrecks their design, so the
// override short-circuits it — and the modal says so before they post.
{
  const LIB = readFileSync('lib/deal-quick-post.ts', 'utf8')
  check('the override skips the deal-card overlay',
    /const postImage = override \|\| \(await buildDealCardImage/.test(LIB),
    'a designed thumbnail must not get a deal badge painted over it')
  check('Instagram reuses the same image',
    /let postImageForIg: string \| null = override/.test(LIB),
    'otherwise an IG-only quick post ignores the override entirely')
  check('so does the pin', /productImageUrl: override \|\| dealImage/.test(LIB))
  check('and so does the story', /imageUrl: override \|\| dealImage/.test(LIB))

  const MODAL = readFileSync('components/deal/QuickPostModal.tsx', 'utf8')
  check('and the modal says it posts as-is', /don&apos;t paint a deal badge|paint a deal badge/.test(MODAL),
    'the deal badge silently going missing is a surprise worth one sentence')
}

// ── the deal BLOG post hero reuses too, and says which image it used ────────
//
// The surface Seb actually reached for first, and the one that is hardest to
// audit: a reused hero and a freshly rendered one are pixel-for-pixel
// indistinguishable on the published article, so if the toast stays quiet
// there is nowhere left to tell them apart.
{
  const DEALS = readFileSync('app/api/deals/route.ts', 'utf8')
  check('the deal route recalls the approved image',
    /const savedHero = await recallProductImage\(supabase, user\.id, asin\)/.test(DEALS))
  check('and uses it instead of rendering', /savedHero[\s\S]{0,60}Promise\.resolve\(savedHero\.imageUrl\)/.test(DEALS),
    'otherwise it pays for a gpt-image render and throws it away')
  check('the DEAL badge is not composited over the creator\u2019s own design',
    !/savedHero[\s\S]{0,400}?buildThumbnailPrompt\([\s\S]{0,200}?savedHero/.test(DEALS),
    'painting a badge over art they designed wrecks it')
  check('the response reports which hero was used', /heroImage: savedHero/.test(DEALS),
    'the published post cannot show the difference, so the API has to')

  const PAGE = readFileSync('app/(dashboard)/deals/page.tsx', 'utf8')
  check('the deals screen prints it', /function heroNote/.test(PAGE))
  check('on every success path, not just one',
    (PAGE.match(/heroNote\(j\)/g) || []).length >= 4,
    'publish, schedule, preview-publish and regenerate all render a hero')
  check('and names the missing badge', /No DEAL badge was added/.test(PAGE),
    'the badge silently going missing is a surprise worth one sentence')
  check('the hero note carries no year',
    /month: 'short', day: 'numeric' \}/.test(PAGE) && !/year: 'numeric'/.test(PAGE),
    'the standing rule, and a date formatter is the likeliest place to break it')
}

// ── every surface that reuses, says so ──────────────────────────────────────
{
  const PANEL = readFileSync('components/product/SavedProductImage.tsx', 'utf8')
  check('the panel shows the actual image', /<img/.test(PANEL))
  check('the panel always offers a way out', /onReplace/.test(PANEL))

  for (const f of ['components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx']) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} shows the panel`, /<SavedProductImage/.test(SRC))
    check(`${f} marks a recalled preview as not a new design`,
      /not a new (design|pin design)/.test(SRC),
      'a recalled image in the preview is otherwise indistinguishable from a fresh render')
    check(`${f} drops the recall when the creator generates`,
      /setUsingSaved\(false\)/.test(SRC),
      'otherwise publishing after a regenerate would skip remembering the new design')
  }
}

// ── the save fires when MVP MAKES the image, not only when it ships ─────────
//
// THE BUG SEB HIT. The first cut only saved on "Apply to YouTube", so a
// creator who generated a thumbnail and did not push it to YouTube — most of
// the time — had nothing remembered, and the Deals Hub had nothing to offer.
{
  const PAGE = readFileSync('app/(dashboard)/co-pilot/page.tsx', 'utf8')
  check('Co-Pilot saves the thumbnail it is showing',
    /useEffect\([\s\S]{0,400}?saveProductImage\(/.test(PAGE),
    'keyed on the visible image, because generate / pick a variant / swap the title / upload are all "finished"')
  check('and re-saves whenever that image changes',
    /\}, \[thumbnailUrl, effectiveAsin\]\)/.test(PAGE),
    'a variant pick or a new title must replace what the product remembers')
}

// ── the ASIN is the one the SERVER resolved, not the one the client guessed ──
//
// THE SECOND BUG, and a repeat of one this codebase already documents: the
// thumbnail form sends `productUrl` and NO `asin` when a link is pasted, which
// is why generate-thumbnail has effAsin at all. Filing images under
// video.detectedAsin alone stored them against null for every overridden
// product.
{
  const PAGE = readFileSync('app/(dashboard)/co-pilot/page.tsx', 'utf8')
  check('Co-Pilot derives an effective ASIN', /const effectiveAsin = /.test(PAGE))
  check('from the override link as well as the detected one',
    /asinFromAmazonUrl\(override\)/.test(PAGE),
    'a pasted Product link override sends no asin at all')
  check('and no apply call still keys off detectedAsin alone',
    !/asin: video\.detectedAsin \?\? undefined,\n\s+thumbnailUploaded/.test(PAGE))

  const ROUTE = readFileSync('app/api/youtube/generate-thumbnail/route.ts', 'utf8')
  check('the route records the ASIN it resolved', /memo\.asin = effAsin/.test(ROUTE))
  check('through one wrapper, not five return sites',
    /export async function POST\(request: Request\) \{[\s\S]{0,900}?generateThumbnail\(request, memo\)/.test(ROUTE),
    'this handler has five success returns and a sixth would silently stop saving')
}

// ── the remembered image is the one with the title on it ────────────────────
//
// THE THIRD BUG. generate-thumbnail returns the TEXT-FREE base and the browser
// bakes the headline on afterwards (addTextOverlay). Saving server-side would
// file the one version the creator never chose.
{
  const ROUTE = readFileSync('app/api/youtube/generate-thumbnail/route.ts', 'utf8')
  check('the route lets a caller defer the save', /deferImageMemory/.test(ROUTE))
  check('and reads the flag off a clone of the request',
    /request\.clone\(\)\.json\(\)/.test(ROUTE),
    'the handler still needs the body stream')

  const PAGE = readFileSync('app/(dashboard)/co-pilot/page.tsx', 'utf8')
  check('Co-Pilot defers on every generate call',
    (PAGE.match(/deferImageMemory: true/g) || []).length === 2,
    'both the first render and the regenerate return a text-free base')
}

// ── and the screen says whether it worked ───────────────────────────────────
{
  const PAGE = readFileSync('app/(dashboard)/co-pilot/page.tsx', 'utf8')
  check('a successful save is stated', /Saved for <span className="font-mono">/.test(PAGE))
  check('a failed save reads differently', /Couldn&apos;t save this for/.test(PAGE),
    'a failed save that looks like a successful one is only discovered in the Deals Hub a week later')
  check('and no product at all is its own message', /No product on this video/.test(PAGE),
    'the commonest reason nothing is remembered, and the one the creator can fix')
}

// ── remembering never breaks the thing the creator actually asked for ───────
{
  for (const f of ['app/api/youtube/apply/route.ts', 'app/api/youtube/update-metadata/route.ts']) {
    const SRC = readFileSync(f, 'utf8')
    check(`${f} only remembers a thumbnail that landed`,
      /if \(appliedThumb && (body\.)?asin\)/.test(SRC),
      'approval means it shipped to YouTube, not that it was generated')
    check(`${f} reports the result, not the attempt`,
      /productImageSaved/.test(SRC),
      'a { ok: true } for a write that did not happen is the bug this repo keeps re-finding')
  }
}

// ── the recall degrades to "no saved image", never to a broken screen ───────
{
  const MEM = readFileSync('lib/product-image-memory.ts', 'utf8')
  check('the recall selects *', /\.select\('\*'\)/.test(MEM),
    'PostgREST 400s the whole statement over one missing column, and migration 331 may not be applied yet')
  check('a failed recall returns null rather than throwing',
    /if \(error \|\| !data\) return null/.test(MEM))
  check('remembering is best-effort', /catch \(err\) \{[\s\S]{0,200}?return null/.test(MEM),
    'a YouTube push must never fail because we could not remember a picture')
}

// ── the migration is re-runnable ────────────────────────────────────────────
{
  const SQL = readFileSync('supabase/migrations/331_product_image_memory.sql', 'utf8')
  check('table creation is guarded', /create table if not exists/.test(SQL))
  check('every added column is guarded', !/alter table[\s\S]*?add column(?! if not exists)/.test(SQL))
  check('policies are dropped before create', (SQL.match(/drop policy if exists/g) || []).length >= 4,
    'create policy has no IF NOT EXISTS, so a second run fails without the drops')
  check('RLS is on', /enable row level security/.test(SQL))
  check('the queue column is guarded too',
    /alter table public\.deal_scheduled_posts add column if not exists image_override/.test(SQL))
}

// ── the creator's own upload survives the bucket's limits ───────────────────
//
// Run against REAL encoded bytes, not a regex over the source. Co-Pilot's
// uploader accepts JPG, PNG, GIF and BMP; the product-images bucket holds only
// png/jpeg/webp. Dropping a creator's GIF would lose the exact image this
// feature exists to keep, so it is converted. Everything below therefore
// encodes a fixture and pushes it through.
async function storageChecks() {
  const gif = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#3355ff' } }).gif().toBuffer()
  check('the GIF fixture really is a GIF', !isAllowedImageMime('image/gif'))
  const g = await normalizeForStorage(Buffer.from(gif), 'image/gif')
  check('an uploaded GIF is converted, not dropped', !!g,
    'this is the one image regenerating can never reproduce')
  check('converted to something the bucket holds', !!g && isAllowedImageMime(g.mimeType), String(g?.mimeType))
  check('and the storage path extension follows the conversion',
    !!g && extForMime(g.mimeType) === 'jpg',
    'a .gif path would name a file the bucket will never hold')
  check('the converted bytes still decode as the same image',
    !!g && (await sharp(g.buffer).metadata()).width === 300)

  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const p = await normalizeForStorage(Buffer.from(png), 'image/png')
  check('an already-acceptable PNG is passed through untouched',
    !!p && p.mimeType === 'image/png' && p.buffer.equals(Buffer.from(png)),
    're-encoding a fine image loses quality for nothing')

  const huge = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#101010' } })
    .png({ compressionLevel: 0 }).toBuffer()
  check('the oversized fixture is genuinely over the ceiling',
    huge.byteLength > MAX_IMAGE_BYTES, `${huge.byteLength} bytes vs ${MAX_IMAGE_BYTES}`)
  const h = await normalizeForStorage(Buffer.from(huge), 'image/png')
  check('an oversized image is resized rather than refused', !!h)
  check('and lands under the ceiling', (h?.buffer.byteLength ?? Infinity) <= MAX_IMAGE_BYTES,
    `${h?.buffer.byteLength} bytes`)

  check('bytes that are not an image at all return null',
    (await normalizeForStorage(Buffer.from('not an image'), 'image/png')) === null,
    'so the caller records nothing rather than pointing at a broken file')

  // The bucket, named once. `headshots` caps at 5 MB and migration 176 flags it
  // as the bucket that may later go private for real face photos — either would
  // break every saved product image parked there.
  const MEM = readFileSync('lib/product-image-memory.ts', 'utf8')
  check('the kept copy goes in the product-images bucket',
    /PRODUCT_IMAGE_BUCKET = 'product-images'/.test(MEM))
  check('the storage path starts with the user id',
    /`\$\{userId\}\/approved\//.test(readFileSync('lib/product-image-limits.ts', 'utf8') + MEM),
    "the bucket's RLS is (storage.foldername(name))[1] = auth.uid()")
  check('our ceiling sits under the bucket\u2019s own 10 MB',
    MAX_IMAGE_BYTES < 10 * 1024 * 1024, `${MAX_IMAGE_BYTES}`)
}

// Top-level await is not available under this tsx/cjs target, so the async
// half runs inside main() and the verdict is printed from there.
storageChecks().then(() => {
  if (failures.length) {
    console.error(`\n❌ product-image-memory: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ product-image-memory: recall is labelled, dated without a year, resolved server-side, what was scheduled is what fires, and an uploaded GIF is converted rather than lost')
})
