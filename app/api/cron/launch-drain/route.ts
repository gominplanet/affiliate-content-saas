// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/launch-drain — do the unattended half of a launch batch.
//
// WHAT THIS EXISTS FOR. Setting up ten videos by hand means sitting through ten
// CTA renders and ten thumbnail builds, all of which run on our servers and
// need nobody present. So the creator adds the videos, makes the three shared
// decisions, and closes the tab. This does the rest.
//
// TWO STEPS PER VIDEO, both bounded:
//
//   RENDER   burn the batch's CTA into this video. One at a time: a render is
//            the heaviest thing here and two at once would run the function out
//            of time mid-write.
//   THUMB    build the branded thumbnail from the product, and the text-free
//            one the non-English stores need.
//
// A STEP THAT COULD NOT RUN IS NOT A VERDICT. Every failure either leaves the
// video where it was for the next firing or blocks it with a sentence naming
// what a creator can do. A video sitting in 'preparing' forever with nothing on
// screen is the failure this codebase keeps producing, so there is a try count
// and the last try says why.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildProductThumbnail } from '@/lib/product-thumbnail'
import { recallProductImage } from '@/lib/product-image-memory'
import { reuseLabel } from '@/lib/product-image-label'
import { renderCta } from '@/lib/youtube-ingest'
import { normalizeTier } from '@/lib/tier'
import { ctaStickerAllowed, ctaTopLeft, type CtaPreset, liftoffMarkets } from '@/lib/launch-batch'
import { validateThumbnailPreset, presetToRequestFields, parseFacePick, type ThumbnailPreset } from '@/lib/thumbnail-preset'
import { postToSelf } from '@/lib/self-url'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { wrongChannelMessage } from '@/lib/launch-channel'
import { generateProductTitleOptions } from '@/lib/title-options'
import { generateAmazonTitleOptions } from '@/lib/amazon-title'
import { asinInFileName } from '@/lib/asin'
import { canUsePreview } from '@/lib/labs-preview'
import { usesStudioUpload, STUDIO_UPLOAD_WAITING, isStudioRunning, isStudioWaiting, studioDid, scheduleHeld, scoutSawPaidPromotion, type StudioDid } from '@/lib/studio-upload'
import { queueFirstComment } from '@/lib/first-comment-queue'
import { YouTubeOAuthService } from '@/services/youtube'
import { normalizeStudioOptions } from '@/lib/studio-finish'
import { cachedLocalAsins } from '@/lib/regional-listing'
import { coveragePriority } from '@/lib/storefront-coverage'
import { marketByDomain } from '@/lib/markets'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { missedWhen, releaseHeld, heldCheckDue, HELD_FOR_PAID_PROMOTION } from '@/lib/launch-release'

export const runtime = 'nodejs'
export const maxDuration = 300

/** CTA renders per firing. One: it is the heaviest call in the file and the
 *  render service is shared with everything else. */
const RENDERS = 1
/** IMAGES per firing, not videos.
 *
 *  Each video needs two: the styled one from the designed route (an art
 *  director pass and an image model, over a network call) and the text-free
 *  copy the non-English stores get, built in process.
 *
 *  Counting VIDEOS meant both of a video's images had to fit in one 300 second
 *  function, which left the styled call about two minutes. The designed path
 *  does not reliably finish in two minutes, so it was abandoned and the plain
 *  builder ran instead: a creator picked a look, waited, and got a thumbnail
 *  that did not use it, with the row saying only that it "could not be
 *  applied". The first real batch did exactly that.
 *
 *  Counting IMAGES gives whichever one runs the whole function. This route
 *  fires every minute, so ten videos take about twenty firings, which is
 *  twenty minutes and still nothing against walking away from the computer. */
const IMAGES = 6
/** Videos worked on side by side in one firing. Each video's two images run
 *  together, so a firing holds at most THUMB_POOL * 2 image calls in flight,
 *  every one of them started only with THUMB_CALL_MS still left on the clock. */
const THUMB_POOL = 3
/** Tries before a video stops asking and says why. */
const TRIES = 3
/** A video bigger than this goes to YouTube in pieces across runs. */
const PIECES_FROM = 100 * 1024 * 1024
/** One piece: a multiple of 256 KiB, as YouTube requires for all but the last. */
const PIECE = 32 * 1024 * 1024
/** Tries for the thumbnail step, which is TWO images and so needs its own
 *  budget. Three each: sharing one budget of three across both would leave a
 *  video that spent two firings succeeding with a single retry left. */
const THUMB_TRIES = 6
/** How long the styled thumbnail call gets.
 *
 *  ONE IMAGE OWNS THE FIRING, so this is nearly the whole function, with room
 *  left for the write afterwards. test-launch-batch does the arithmetic against
 *  maxDuration so raising either number fails the build rather than the batch. */
const THUMB_CALL_MS = 240_000
/** How long the description writer gets. Text only, so seconds rather than
 *  minutes, and it shares a firing with an image generation. */
const META_CALL_MS = 60_000
/** Videos pushed to YouTube per firing. ONE: this downloads a whole file and
 *  uploads it again, which is the longest single operation in the product. */
const PUBLISHES = 1
/** The most a video may be before this refuses to push it, matching the
 *  interactive uploader so a batch cannot smuggle through something a single
 *  upload would have rejected. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any
/** Milliseconds this firing may still spend. */
type Left = () => number

/**
 * Burn the batch's CTA into each video that has not had it yet.
 *
 * THE SAME CTA ON ALL OF THEM, which is the whole point of choosing it once:
 * same design, same corner, same size. It comes off the batch rather than the
 * item, so there is no per-video copy to drift.
 *
 * A batch whose creator chose NO CTA skips straight to prepared: the upload is
 * already the finished video, and it is also what Amazon should receive.
 */
/**
 * Each batch's confirmed YouTube channel (migration 372), read on its own so
 * a database without the column uploads through the default channel, as it
 * always did. A batch with no confirmed channel also uses the default: only a
 * batch launched before the check existed can be in that state.
 */
async function channelsForBatches(sb: Sb, batchIds: string[]): Promise<{ map: Map<string, string | null>; failed: boolean }> {
  const map = new Map<string, string | null>()
  if (batchIds.length === 0) return { map, failed: false }
  const { data, error } = await sb.from('launch_batches').select('id,youtube_channel_id').in('id', batchIds)
  if (error) {
    // ONLY A MISSING COLUMN MEANS "NO CHANNEL". Any other failure (a timeout,
    // a dropped connection) is not an answer, and reading it as one sent a
    // batch confirmed to another channel through the default login, unchecked.
    const missing = error.code === '42703' || /youtube_channel_id/.test(String(error.message || ''))
    return { map, failed: !missing }
  }
  for (const b of (data ?? []) as Array<{ id: string; youtube_channel_id: string | null }>) {
    map.set(b.id, String(b.youtube_channel_id || '').trim() || null)
  }
  return { map, failed: false }
}

/**
 * A CTA badge's height over its width, read from the PNG's own header (the
 * first 24 bytes), so the badge is centred on the spot the creator picked
 * rather than on a guess at its size. 1 when it cannot be read.
 */
const stickerAspects = new Map<string, number>()
async function stickerAspect(url: string): Promise<number> {
  const known = stickerAspects.get(url)
  if (known) return known
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 10_000, headers: { Range: 'bytes=0-63' } })
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      // PNG: an 8-byte signature, then IHDR with width and height big-endian.
      if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
        const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
        // REMEMBERED ONLY WHEN READ. A failed fetch guesses square for this
        // render and asks again next time, rather than for the life of the server.
        if (w > 0 && h > 0) { stickerAspects.set(url, h / w); return h / w }
      }
    }
  } catch { /* a square guess, still centred */ }
  return 1
}

async function renders(sb: Sb, left: Left): Promise<{ done: number; skipped: number; failed: number; recovered: number }> {
  const now = () => new Date().toISOString()

  // ── A RENDER THAT NEVER REPORTED BACK GOES ROUND AGAIN ──────────────────
  // A firing killed mid-render left its row on 'rendering', which nothing
  // picked up again and Try again refused, while the page said "This finishes
  // on its own" forever. A row that has said nothing for ten minutes is back
  // in the queue, its try already counted, with the reason on it.
  const stale = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: stuck } = await sb.from('launch_items')
    .update({ state: 'draft', reason: 'The last CTA render did not report back, so it is being tried again.', updated_at: now() })
    .eq('state', 'rendering').lt('updated_at', stale).select('id')
  const recovered = (stuck ?? []).length

  // MORE THAN THE BUDGET, because rows waiting on a CTA decision are skipped,
  // and a short list of those used to hold every other creator's renders up
  // indefinitely.
  const { data: rows } = await sb.from('launch_items')
    .select('id,batch_id,user_id,source_url,render_tries,reason')
    .eq('state', 'draft').not('source_url', 'is', null)
    .order('created_at', { ascending: true }).limit(60)
  const items = rows ?? []
  if (items.length === 0) return { done: 0, skipped: 0, failed: 0, recovered }

  let done = 0, skipped = 0, failed = 0
  let budget = RENDERS
  const batches = new Map<string, { cta: unknown; cta_chosen: boolean | null } | null>()

  for (const it of items) {
    if (budget <= 0) break
    if (!batches.has(it.batch_id)) {
      const { data: b } = await sb.from('launch_batches')
        .select('cta,cta_chosen').eq('id', it.batch_id).maybeSingle()
      batches.set(it.batch_id, b ?? null)
    }
    const batch = batches.get(it.batch_id)
    // The creator has not decided yet. Not a failure, just not this video's
    // turn, and touching it would be inventing news.
    if (!batch?.cta_chosen) continue

    const cta = (batch.cta ?? null) as CtaPreset | null
    if (!cta?.stickerUrl) {
      // NO CTA IS A REAL CHOICE. The uploaded file is the finished video, and
      // it is the same file for both destinations.
      await sb.from('launch_items').update({
        rendered_url: it.source_url, clean_url: it.source_url,
        state: 'preparing', reason: null, updated_at: now(),
      }).eq('id', it.id)
      skipped++
      continue
    }

    // RE-CHECKED HERE, not only when it was stored. This composites an image
    // into ten videos with nobody watching, so the URL is validated again at
    // the moment it is used rather than trusted because it was validated once.
    if (!ctaStickerAllowed(cta.stickerUrl, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: 'That CTA design is not one MVP recognises. Choose one from the gallery and this will run again.',
        updated_at: now(),
      }).eq('id', it.id)
      failed++
      continue
    }

    const tries = Number(it.render_tries ?? 0)
    if (tries >= TRIES) {
      // THE LAST REAL ERROR SURVIVES, same as the publish step. Each attempt
      // wrote what actually went wrong, and giving up used to overwrite it
      // with a sentence that fits every cause equally badly.
      const said = String(it.reason || '').trim()
      const generic = /^The CTA could not be burned in/.test(said)
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: said && !generic
          ? `The CTA could not be burned in after ${tries} tries. The last thing that went wrong: ${said}`.slice(0, 300)
          : `The CTA could not be burned in after ${tries} tries, and nothing said why. Remove this video and add it again, or launch the batch without a CTA.`,
        updated_at: now(),
      }).eq('id', it.id)
      failed++
      continue
    }

    // COUNTED BEFORE THE ATTEMPT. A render that kills the function would
    // otherwise never record the try and this video would retry forever.
    // ONLY WITH TIME TO FINISH. A render takes minutes, and one started with
    // less than that left is one the platform kills part way.
    if (left() < 200_000) break
    // CLAIMED, not just marked: an overlapping firing that already took this
    // row gets nothing back and moves on, rather than rendering it twice.
    // THE CLAIM'S OWN STAMP is what later writes match on. The try count is
    // not enough: a CTA change resets it to 0, the next claim sets it back to
    // 1, and a stale first render matched that and landed on top.
    const renderClaim = now()
    const { data: claimed } = await sb.from('launch_items')
      .update({ state: 'rendering', render_tries: tries + 1, updated_at: renderClaim })
      .eq('id', it.id).eq('state', 'draft').select('id')
    if (!claimed || claimed.length === 0) continue
    budget--

    try {
      const { data: v } = await sb.from('launch_items').select('duration_seconds').eq('id', it.id).maybeSingle()
      const dur = Number(v?.duration_seconds) || 0
      // THE SAME WINDOW THE INTERACTIVE PATH USES. An end card rides the last
      // eight seconds; a lower third shows early for about ten. Derived here
      // rather than stored, so a batch made last week burns in the same way a
      // single video does today.
      const startSec = cta.style === 'endcard' && dur > 0 ? Math.max(0, dur - 8) : 3
      const endSec = cta.style === 'endcard' && dur > 0 ? dur : (dur > 0 ? Math.min(dur, 13) : 13)
      // THE CENTRE THE CREATOR PICKED, sent as the corner the service places.
      const corner = ctaTopLeft(cta, await stickerAspect(cta.stickerUrl))
      const out = await renderCta(it.source_url as string, {
        text: '', subtext: '', style: cta.style, startSec, endSec,
        stickerUrl: cta.stickerUrl, widthPct: cta.widthPct, xPct: corner.x, yPct: corner.y,
      }, it.user_id as string, left() - 15_000)
      if (!out.ok) throw new Error(out.reason || 'the render did not finish')
      // TWO FILES FROM HERE ON, AND THEY GO TO DIFFERENT PLACES.
      //
      // The CTA is for YouTube ONLY. It says "link in the description", which
      // is true on a YouTube watch page and false on an Amazon storefront,
      // where there is no description and no link: a burned-in call to action
      // pointing at nothing is at best confusing and at worst a listing
      // Amazon rejects.
      //
      // So `rendered_url` is the burned copy YouTube gets, and `clean_url` is
      // the file the creator uploaded, untouched, which is what goes to every
      // storefront. This column was read by the Amazon hand-off from the day it
      // was written and never set by anything, so every batch listing was
      // handed a null video.
      // ONLY OVER THE RENDER THIS FIRING CLAIMED. A CTA changed while it was
      // burning in sends the row back to draft with its tries reset, and this
      // render (the old CTA) must not land on top of that.
      await sb.from('launch_items').update({
        rendered_url: out.url, clean_url: it.source_url,
        state: 'preparing', reason: null, updated_at: now(),
      }).eq('id', it.id).eq('state', 'rendering').eq('updated_at', renderClaim)
      done++
    } catch (e) {
      // BACK TO DRAFT so the next firing picks it up again, with the reason on
      // the row so the board is not silent while it waits.
      await sb.from('launch_items').update({
        state: 'draft',
        reason: (e instanceof Error ? e.message : 'the render did not finish').slice(0, 200),
        updated_at: now(),
      }).eq('id', it.id).eq('state', 'rendering').eq('updated_at', renderClaim)
      failed++
    }
  }
  return { done, skipped, failed, recovered }
}

/**
 * Build each video's thumbnail, and the text-free copy the non-English stores
 * need.
 *
 * TWO IMAGES, DELIBERATELY. The branded one carries the English hook and goes
 * to YouTube and the English storefronts. The text-free one goes to the rest,
 * because English wording sitting on a German listing is the same class of
 * failure as English audio under a translated title.
 */
async function thumbs(sb: Sb, left: Left): Promise<{ done: number; blocked: number; plain: number; failed: number; metaMissing: number }> {
  // More rows than the budget, because rows still waiting for a product are
  // skipped, and a short list of those used to hold every other creator up.
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,asin,title,title_source,description,tags,thumbnail_url,thumbnail_clean_url,thumb_tries,updated_at')
    .eq('state', 'preparing')
    .order('created_at', { ascending: true }).limit(40)
  const items = rows ?? []
  if (items.length === 0) return { done: 0, blocked: 0, plain: 0, failed: 0, metaMissing: 0 }

  let done = 0, blocked = 0, plain = 0, failed = 0, metaMissing = 0
  let budget = IMAGES
  const now = () => new Date().toISOString()

  // AMAZON-ONLY BATCHES WRITE NO YOUTUBE TEXT. The description is where the
  // YouTube affiliate link goes; a batch that never reaches YouTube does not
  // need one, and asking Co-Pilot for it spent a run per video (and on the
  // Amazon plan, before 2026-10-05, was refused every time and retried until
  // it gave up). Read once per batch; a database without the column is a
  // batch that goes to YouTube, as before.
  const amazonOnlyByBatch = new Map<string, boolean>()
  const isAmazonOnly = async (batchId: string): Promise<boolean> => {
    const cached = amazonOnlyByBatch.get(batchId)
    if (cached !== undefined) return cached
    const { data: b, error: bErr } = await sb.from('launch_batches').select('send_to_youtube').eq('id', batchId).maybeSingle()
    const only = !bErr && b?.send_to_youtube === false
    amazonOnlyByBatch.set(batchId, only)
    return only
  }

  // The batch's chosen look, read once per batch rather than once per video.
  const presetByBatch = new Map<string, ThumbnailPreset>()
  const loadPreset = async (batchId: string): Promise<ThumbnailPreset> => {
    const cached = presetByBatch.get(batchId)
    if (cached) return cached
    const { data: b } = await sb.from('launch_batches').select('thumbnail').eq('id', batchId).maybeSingle()
    // Re-validated on the way OUT of the database, not only on the way in. The
    // row may predate a field, or have been written by an older build, and this
    // is the last point before ten image generations act on it.
    const { preset } = validateThumbnailPreset(b?.thumbnail ?? null, process.env.NEXT_PUBLIC_SUPABASE_URL)
    presetByBatch.set(batchId, preset)
    return preset
  }

  // ── SEVERAL VIDEOS AT ONCE ───────────────────────────────────────────────
  //
  // One video at a time, one image per firing, and preparing only every other
  // minute: three videos needed six firings end to end, and the creator
  // watched them sit for half an hour. Each image is a network call that
  // spends its time waiting, so THUMB_POOL videos are worked on side by side,
  // each against the same claim, the same budget and the same clock checks it
  // always had. Nothing below starts without time to finish.
  const one = async (it: (typeof items)[number]): Promise<'stop' | void> => {
    if (budget <= 0) return 'stop'
    // Nothing starts without time to finish it: the write at the end is what
    // makes the work count, and a firing killed before it throws the work away.
    if (left() < 60_000) return 'stop'
    let asin = (it.asin || '').trim()
    let title = (it.title || '').trim()
    // THE PRODUCT IN THE FILE NAME, for a video added before the page read it.
    // Only into an empty product and only while the title is still the file
    // name, so nothing the creator set is second-guessed.
    if (!asin && (it.title_source ?? 'filename') === 'filename') {
      const fromName = asinInFileName(title)
      if (fromName) {
        const { data: set } = await sb.from('launch_items')
          .update({ asin: fromName, updated_at: now() }).eq('id', it.id).is('asin', null).select('id')
        if ((set ?? []).length > 0) asin = fromName
      }
    }
    // NOT BLOCKED, WAITING. The creator sets the product in their own time and
    // this is the one step that genuinely needs them.
    if (!asin || !title) return

    // ANOTHER FIRING HAS THIS ONE. Firings overlap (one a minute, up to five
    // minutes each), and a row touched in the last five and a half minutes
    // with a try already counted is being built right now. Building it twice
    // spends two images and two of its tries on one thumbnail.
    const tries = Number(it.thumb_tries ?? 0)
    if (tries > 0 && it.updated_at && Date.now() - new Date(it.updated_at).getTime() < 330_000) return

    // ── THE TITLE MVP WRITES, NOT THE NAME OF THE FILE ───────────────────
    //
    // Adding videos to a batch seeded each title from the uploaded file name,
    // and nothing ever replaced it. The thumbnail hook is written from the
    // product first (a short, image-sized line), and the YouTube title comes
    // with the description below.
    //
    // ONLY WHAT NOBODY CHOSE. 'creator' is never touched, and the write is
    // conditional on it still not being 'creator', so a title typed while this
    // firing was working is not overwritten by it.
    // A ROW WITH NO SOURCE AT ALL counts as nobody's: in SQL, NULL <> 'creator'
    // is not true, so a plain "not creator" filter skipped exactly those rows
    // and their file-name titles went to YouTube.
    const titleSource = String(it.title_source || 'filename')
    if (titleSource !== 'creator' && titleSource !== 'mvp') {
      const written = await productTitle(it.user_id, title, asin)
      if (written) {
        title = written
        await sb.from('launch_items')
          .update({ title, title_source: 'mvp', updated_at: now() }).eq('id', it.id).or('title_source.is.null,title_source.neq.creator')
      }
    }

    // ── THE DESCRIPTION FIRST, WHICH IS WHERE THE AFFILIATE LINK LIVES ───
    //
    // Without it a batch video went to YouTube with an EMPTY description while
    // the CTA burned into its own frame said "link in the description". It is
    // written before the images now (seconds, not minutes), and on its own:
    // only into a row that still has no description, and the title only while
    // the creator has not typed one, so nothing they wrote during this firing
    // is replaced by it.
    let haveDescription = !!String(it.description || '').trim() || await isAmazonOnly(String(it.batch_id))
    let metaTried = false
    // The YouTube title, as a hint for the Amazon title writer. `title` stays
    // the hook the thumbnail is built from.
    let ytTitle = title
    if (!haveDescription && left() > 90_000) {
      metaTried = true
      const meta = await videoMetadata(it.user_id, title, asin)
      if (meta?.description) {
        const { data: d } = await sb.from('launch_items')
          .update({ description: meta.description, ...(meta.tags?.length ? { tags: meta.tags.join(', ') } : {}), updated_at: now() })
          .eq('id', it.id).is('description', null).select('id')
        haveDescription = true
        // THE YOUTUBE TITLE CO-PILOT WOULD WRITE. The hook above ("CHIA WORTH
        // IT?") is right on the image and wrong as a YouTube title, and it went
        // to YouTube as one because this title, returned by the same call, was
        // thrown away. Only alongside the description it came with.
        if ((d ?? []).length > 0 && meta.title) {
          await sb.from('launch_items')
            .update({ title: meta.title.slice(0, 100), title_source: 'mvp', updated_at: now() })
            .eq('id', it.id).or('title_source.is.null,title_source.neq.creator')
          ytTitle = meta.title.slice(0, 100)
        }
      } else {
        metaMissing++
      }
    }

    // ── THE AMAZON TITLE, WRITTEN WHILE THERE IS STILL TIME TO READ IT ───
    // Written during prepare, so it is in the row's "Title for Amazon" box
    // before launch (the hand-over writes one too if this never ran). NOT
    // HERE, before the images: a thumbnail may only start in the first
    // seconds of a firing, and a slow title writer used to spend them. It is
    // written beside the images below, or here once the images are done.

    // ONE THUMBNAIL FOR EVERY COUNTRY. Amazon's non-English storefronts take a
    // thumbnail with an English title on it, so the second, wordless image is
    // no longer built: it cost an image and a firing per video for nothing.
    // Has its thumbnail: ready, once it also has its description.
    if (it.thumbnail_url) {
      if (left() > 60_000) await ensureAmazonTitle(sb, it.id, it.user_id, asin, ytTitle)
      if (haveDescription) {
        await sb.from('launch_items')
          .update({ state: 'prepared', reason: null, updated_at: now() }).eq('id', it.id).eq('state', 'preparing')
        done++
      } else if (tries >= THUMB_TRIES) {
        // SAID, NOT HIDDEN: it goes without a link rather than never, and the
        // row says so while there is still time to add one.
        await sb.from('launch_items').update({
          state: 'prepared',
          reason: 'No description could be written, so this video has no affiliate link. Add one in its row before you launch.',
          updated_at: now(),
        }).eq('id', it.id).eq('state', 'preparing')
        done++
      } else if (metaTried) {
        await sb.from('launch_items')
          .update({ thumb_tries: tries + 1, reason: 'Writing the description, where the affiliate link goes. Trying again.', updated_at: now() })
          .eq('id', it.id)
      }
      return
    }

    if (tries >= THUMB_TRIES) {
      // PREPARED ANYWAY, because a missing thumbnail does not stop a listing:
      // YouTube takes a frame from the video. Said on the row so the creator
      // knows what their listing will look like rather than finding out later.
      await sb.from('launch_items').update({
        state: 'prepared',
        // BOTH GAPS, when there are two. The missing description is the one
        // that costs money (no affiliate link), and it used to go unsaid here.
        reason: `No thumbnail could be built after ${tries} tries, so YouTube will use a frame from the video.`
          + (haveDescription ? '' : ' No description could be written either, so it has no affiliate link. Add one in its row before you launch.'),
        updated_at: now(),
      }).eq('id', it.id).eq('state', 'preparing')
      blocked++
      return
    }

    // AN IMAGE ONLY WITH TIME FOR IT. The styled call is allowed four minutes;
    // started with less left, the platform kills it and the image is lost.
    if (left() < THUMB_CALL_MS + 30_000) return 'stop'

    // CLAIMED on the try count it was read with, so two firings reaching the
    // same row at the same moment cannot both build it.
    // Stamped, for the same reason as the render claim: the final write
    // matches this claim, not a try count a product change can reset.
    // THE IMAGES ARE RESERVED BEFORE THE CLAIM, not taken after it. With
    // several videos in flight, two could both pass a "budget left" check,
    // both claim, and the second get no image at all: a try spent on nothing,
    // and after six of those the row said no thumbnail could be built.
    const need = it.thumbnail_url ? 0 : 1
    const reserved = Math.min(need, budget)
    if (reserved === 0) return 'stop'
    budget -= reserved
    let mine = reserved

    const thumbClaim = now()
    const claim = sb.from('launch_items').update({ thumb_tries: tries + 1, updated_at: thumbClaim }).eq('id', it.id)
    const { data: claimed } = await (it.thumb_tries == null ? claim.is('thumb_tries', null) : claim.eq('thumb_tries', tries)).select('id')
    if (!claimed || claimed.length === 0) { budget += reserved; return }

    const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', it.user_id).maybeSingle()
    const tier = normalizeTier(integ?.tier)
    const patch: Record<string, unknown> = { updated_at: now() }
    // THIS VIDEO'S OWN FACE, when it has one: one presenter on this video,
    // the other on the next, nobody on the one after. Read on its own, so a
    // database without migration 371 builds every video with the batch's face.
    const batchPreset = await loadPreset(it.batch_id)
    let preset = batchPreset
    {
      const { data: fr, error: frErr } = await sb.from('launch_items').select('thumbnail_face').eq('id', it.id).maybeSingle()
      const own = frErr ? null : parseFacePick(fr?.thumbnail_face)
      if (own) preset = { ...batchPreset, face: own }
    }
    let usedPlain = false
    // A thumbnail reused from the product's memory rather than rendered now.
    let usedSaved = false
    let savedLabel = ''
    // WHY it fell back, kept so the row can say it. "Could not be applied" is
    // true of a timeout, a missing face and a spend cap alike, and none of
    // those has the same answer.
    let plainWhy = ''
    // BOTH IMAGES AT ONCE when both are missing. They do not depend on each
    // other (the clean copy is built from the product, not from the styled
    // image), and one after the other was two firings per video.
    const styledJob = async () => {
      if (!it.thumbnail_url && mine > 0) {
        mine--
        try {
          // THE SAME GENERATOR VIDEO LAUNCHPAD USES, with the batch's chosen
          // look.
          const branded = await styledThumbnail(it.user_id, title, asin, preset)
          if (branded.url) patch.thumbnail_url = branded.url
          else {
            plainWhy = branded.why
            // THE FALLBACK IS RECORDED, NOT HIDDEN, and only attempted with time
            // left to save it; otherwise the next firing tries the look again.
            // NOT WHEN THE PLAN SAID NO. A refusal for the thumbnail allowance or
            // the spend ceiling is an answer, and the plain image would have
            // been a second render the plan had just refused.
            // REUSE BEFORE RENDERING. A thumbnail MVP already made for this
            // product (lib/product-image-memory) costs nothing and is a design
            // the creator already had; a new plain render costs a thumbnail.
            // Used even when the plan said no, since it renders nothing.
            const saved = await recallProductImage(sb, it.user_id, asin).catch(() => null)
            if (saved?.imageUrl) {
              patch.thumbnail_url = saved.imageUrl; usedSaved = true
              const l = reuseLabel(saved)
              savedLabel = `${l.text}.${l.note ? ` ${l.note}` : ''}`
            } else if (branded.limited) {
              /* plainWhy already carries the route's own words */
            } else if (left() > 75_000) {
              const basic = await buildProductThumbnail(sb, { userId: it.user_id, tier, title, asin, withText: true })
              if (basic) { patch.thumbnail_url = basic; usedPlain = true }
            }
          }
        } catch { /* the try is already counted; the next firing has another go */ }
      }
    }
    // The Amazon title beside the images: seconds against their minutes.
    // TIME-BOXED: the title writer must never keep two finished images waiting
    // past the end of the firing. If it is slow, the next firing writes it.
    const titleBox = Math.max(0, Math.min(30_000, left() - 45_000))
    await Promise.all([
      styledJob(),
      Promise.race([ensureAmazonTitle(sb, it.id, it.user_id, asin, ytTitle), new Promise((res) => setTimeout(res, titleBox))]),
    ])

    if (patch.thumbnail_url) {
      patch.thumbnail_source = usedSaved ? 'saved' : usedPlain ? 'plain' : 'styled'
      if (usedPlain) plain++
    }
    const haveBranded = patch.thumbnail_url || it.thumbnail_url
    if (haveBranded && haveDescription) {
      patch.state = 'prepared'
      // The fallback keeps its sentence. Clearing `reason` on the way to
      // 'prepared' would erase the one place the creator could read that this
      // thumbnail is not the look they chose.
      patch.reason = usedSaved
        ? `Your chosen look could not be applied, so MVP used the thumbnail it already made for this product instead of making a new one. ${savedLabel} ${plainWhy}`.trim()
        : usedPlain
        ? `Your chosen look could not be applied, so this is the plain product thumbnail. ${plainWhy}`.trim()
        : null
      done++
    }
    // ── THE WRITE IS CHECKED ─────────────────────────────────────────────
    //
    // A column this patch names that the database does not have fails the
    // whole update, so the state never moves and the screen reports the same
    // sentence forever. The failure lands on the row in words, through a
    // SECOND write that touches only columns the table has always had.
    // ONLY OVER THE ROW THIS FIRING CLAIMED. A product changed meanwhile
    // resets the thumbnails and their try count, and this firing's image,
    // built for the old product, must not land on top of that.
    const { error: wrote } = await sb.from('launch_items').update(patch)
      .eq('id', it.id).eq('state', 'preparing').eq('updated_at', thumbClaim)
    if (wrote) {
      failed++
      await sb.from('launch_items').update({
        reason: `The thumbnail was built but could not be saved: ${String(wrote.message || wrote).slice(0, 140)}`,
        updated_at: now(),
      }).eq('id', it.id)
    }
  }
  const queue = [...items]
  let stopped = false
  await Promise.all(Array.from({ length: THUMB_POOL }, async () => {
    while (!stopped) {
      const it = queue.shift()
      if (!it) return
      if ((await one(it)) === 'stop') stopped = true
    }
  }))
  return { done, blocked, plain, failed, metaMissing }
}

/**
 * The title's description and tags, from the writer Launchpad uses.
 *
 * THE DESCRIPTION IS THE AFFILIATE LINK. That is the whole reason this is not
 * optional: the CTA burned into every one of these videos says "link in the
 * description", and an empty description makes that sentence a lie and the
 * video unpaid.
 *
 * Returns null rather than throwing. A video with no description is worse than
 * one with, and far better than one that never goes up at all.
 */
/**
 * Write one English title for a video from its product.
 *
 * THE SAME WRITER THE BUTTON USES, and the same one Launchpad uses, so a title
 * written by the worker and a title written by a press come from one place
 * rather than two that drift. It takes the first option because there is
 * nobody here to pick, which is the whole point of the unattended half.
 *
 * Returns null rather than throwing: a poor title is better than no video.
 */
async function productTitle(
  userId: string, current: string, asin: string,
): Promise<string | null> {
  try {
    const { data: integ } = await (createAdminClient() as Sb)
      .from('integrations').select('tier').eq('user_id', userId).maybeSingle()
    // THE FILE NAME IS NOT A HINT. Feeding it back in as the video's subject is
    // how a writer produced five variations on a file name. The product's real
    // name is looked up from the ASIN and that is the subject.
    const options = await generateProductTitleOptions({
      videoTitle: '',
      asin,
      count: 3,
      ctx: { userId, tier: normalizeTier(integ?.tier) },
    })
    const first = (options ?? []).map((t) => String(t || '').trim()).filter(Boolean)[0] || ''
    // NOT A SWAP FOR THE SAME THING. If the writer hands back what is already
    // there, writing it would spend a call and change nothing.
    if (!first || first.toLowerCase() === current.trim().toLowerCase()) return null
    return first.slice(0, 100)
  } catch {
    return null
  }
}

/**
 * The storefront title for one video: the one the creator typed, the one MVP
 * wrote before, or a new one written now in their storefront's style.
 *
 * ONLY INTO AN EMPTY BOX. The write is conditional on amazon_title still being
 * null, so a title typed while this was writing is never replaced.
 *
 * TOLERANT OF MIGRATION 370 NOT BEING RUN: the column is read on its own, and a
 * database without it returns null here, which leaves every listing on the
 * YouTube title exactly as before.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAmazonTitle(sb: any, itemId: string, userId: string, asin: string | null, youtubeTitle: string): Promise<string | null> {
  try {
    const { data: row, error } = await sb.from('launch_items').select('amazon_title').eq('id', itemId).maybeSingle()
    if (error) return null
    const have = String(row?.amazon_title || '').trim()
    if (have) return have
    if (!asin) return null
    const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
    const options = await generateAmazonTitleOptions({
      asin, videoTitle: youtubeTitle, count: 3,
      ctx: { userId, tier: normalizeTier(integ?.tier) },
    })
    const first = options[0]
    if (!first) return null
    // STILL THE SAME PRODUCT: a product changed while this was writing clears
    // the title, and a title for the old product must not fill it again.
    const { data: wrote } = await sb.from('launch_items')
      .update({ amazon_title: first }).eq('id', itemId).is('amazon_title', null).eq('asin', asin).select('id')
    if ((wrote ?? []).length > 0) return first
    // Somebody typed one meanwhile: theirs is the title.
    const { data: again } = await sb.from('launch_items').select('amazon_title').eq('id', itemId).maybeSingle()
    return String(again?.amazon_title || '').trim() || null
  } catch {
    return null
  }
}

async function videoMetadata(
  userId: string, title: string, asin: string,
): Promise<{ description: string; tags: string[]; title: string | null } | null> {
  try {
    const res = await postToSelf({
      path: '/api/youtube/generate-metadata',
      userId,
      timeoutMs: META_CALL_MS,
      body: { videoTitle: title, asin: asin || undefined, skipAsinCheck: !asin },
    })
    if (!res.ok) return null
    const j = await res.json().catch(() => ({})) as { generated?: { title?: string; description?: string; tags?: string[] } }
    const description = String(j.generated?.description || '').trim()
    if (!description) return null
    const t = String(j.generated?.title || '').trim()
    return { description, tags: Array.isArray(j.generated?.tags) ? j.generated!.tags! : [], title: t || null }
  } catch {
    return null
  }
}

/**
 * One thumbnail from the batch's chosen look, via the route Launchpad uses.
 *
 * Returns null rather than throwing, because the caller has a plain fallback
 * and a batch that stops on a styling failure would be worse than one that
 * finishes and says the look did not apply.
 */
async function styledThumbnail(
  userId: string, title: string, asin: string, preset: ThumbnailPreset,
): Promise<{ url: string | null; why: string; limited?: boolean }> {
  const started = Date.now()
  const secs = () => Math.round((Date.now() - started) / 1000)
  try {
    const res = await postToSelf({
      path: '/api/youtube/generate-thumbnail',
      userId,
      timeoutMs: THUMB_CALL_MS,
      body: {
        videoTitle: title,
        asin,
        // 'graphic' is what Launchpad and Co-Pilot send: the designed path at a
        // clean 1280x720 with safe margins. Anything else is a different image
        // from the same controls.
        textMode: 'graphic',
        // Filed under Liftoff in the product's image memory.
        memorySurface: 'Liftoff',
        ...presetToRequestFields(preset),
      },
    })
    if (!res.ok) {
      // THE ROUTE'S OWN WORDS. It refuses for real reasons a creator can act
      // on (no saved face, a spend cap, an ASIN it cannot fetch), and throwing
      // all of them away left one sentence that fitted every cause equally
      // badly and pointed at none of them.
      const body = await res.json().catch(() => ({})) as { error?: string; capExceeded?: boolean; spendCapped?: boolean; limitReached?: boolean }
      const said = String(body.error || '').trim().slice(0, 160)
      const limited = res.status === 429 || !!body.capExceeded || !!body.spendCapped || !!body.limitReached
      return { url: null, why: said || `the thumbnail service answered ${res.status} after ${secs()}s`, limited }
    }
    const j = await res.json().catch(() => ({})) as { thumbnailUrl?: string; thumbnailUrls?: string[] }
    const url = j.thumbnailUrl || (Array.isArray(j.thumbnailUrls) ? j.thumbnailUrls[0] : null)
    if (typeof url === 'string' && url) return { url, why: '' }
    return { url: null, why: `the thumbnail service returned no image after ${secs()}s` }
  } catch (e) {
    // A TIMEOUT NAMES ITSELF, because it is the one cause whose fix is a
    // number in this file rather than anything the creator can do, and it is
    // indistinguishable from every other failure without being said.
    const msg = e instanceof Error ? e.message : String(e)
    const timedOut = /abort|timeout|timed out/i.test(msg)
    return {
      url: null,
      why: timedOut
        ? `the thumbnail took longer than ${Math.round(THUMB_CALL_MS / 1000)}s, so it was given up on at ${secs()}s`
        : `${msg.slice(0, 140)} (after ${secs()}s)`,
    }
  }
}

/**
 * Push one prepared video to YouTube and tell YouTube when to make it public.
 *
 * SCHEDULED, NOT PUBLISHED. It goes up private with a publishAt, which is what
 * "3 a day at 09:00, 13:00 and 18:00" actually means: the file is on YouTube
 * tonight and it appears on the channel at the hour the creator chose.
 *
 * THE FACT IS WRITTEN AFTER YOUTUBE CONFIRMS IT. `planned_publish_at` was our
 * intention; `publish_at` is only set once the status call came back. A screen
 * reading the plan would promise a publication that never happened, which is
 * the failure this codebase keeps producing in other shapes.
 *
 * THEN IT JOINS THE COVERAGE GRID. Once a video is on YouTube it is an ordinary
 * video, so the Amazon half is the same standing grid everything else uses
 * rather than a second pipeline nobody maintains.
 */
/** A missed slot in plain words, in the creator's own zone. Their 17:00 read
 *  back as "21:00 UTC" would look like a second mistake on top of the first. */
/** The owner's plan, read once per creator per firing. */
const tierCache = new Map<string, string | null>()
async function ownerTier(sb: Sb, userId: string): Promise<string | null> {
  if (tierCache.has(userId)) return tierCache.get(userId) ?? null
  const { data } = await sb.from('integrations').select('tier').eq('user_id', userId).maybeSingle()
  const t = (data?.tier as string | undefined) ?? null
  tierCache.set(userId, t)
  return t
}

async function publishes(sb: Sb, left: Left): Promise<{ scheduled: number; failed: number }> {
  // Creators whose channel hit its own daily upload limit this run.
  const capped = new Set<string>()
  tierCache.clear()
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,position,title,description,tags,rendered_url,clean_url,thumbnail_url,thumbnail_clean_url,asin,duration_seconds,planned_publish_at,publish_tries,reason,youtube_video_id,updated_at')
    .eq('state', 'prepared').not('planned_publish_at', 'is', null)
    // Room for rows waiting on SCOUT's Studio upload (below), which are passed
    // over here and must not crowd out the rows this firing can upload.
    .order('planned_publish_at', { ascending: true }).limit(PUBLISHES * 4 + 40)
  const items = rows ?? []
  if (items.length === 0) return { scheduled: 0, failed: 0 }

  // WHICH OF THESE THE CREATOR AGREED TO SEND NOW (migration 365). Read on its
  // own so that a missing column cannot stop every upload: on any error the
  // set is empty, which means nothing goes public unasked. A video whose time
  // has gone and is not in this set is kept private and flagged.
  const agreedNow = new Set<string>()
  {
    const { data: nowRows, error: nowErr } = await sb.from('launch_items')
      .select('id').in('id', items.map((i: { id: string }) => i.id)).eq('publish_now', true)
    if (!nowErr) for (const r of (nowRows ?? []) as Array<{ id: string }>) agreedNow.add(r.id)
  }

  // YOUTUBE UPLOAD SESSIONS IN PROGRESS (migration 396), read on their own so
  // a missing column only turns off sending in pieces, never every upload.
  const ytSessions = new Map<string, string>()
  let piecesOn = false
  {
    const { data: sRows, error: sErr } = await sb.from('launch_items')
      .select('id,yt_upload_url').in('id', items.map((i: { id: string }) => i.id))
    if (!sErr) {
      piecesOn = true
      for (const r of (sRows ?? []) as Array<{ id: string; yt_upload_url: string | null }>) if (r.yt_upload_url) ytSessions.set(r.id, r.yt_upload_url)
    }
  }

  // WHAT SCOUT ALREADY DID IN STUDIO for the videos it uploaded (migration
  // 399), read on its own: on any error the map is empty and every step goes
  // through the API, as it did before.
  const studioByItem = new Map<string, StudioDid>()
  const studioPaidByItem = new Set<string>()
  {
    const { data: sRows, error: sErr } = await sb.from('launch_items')
      .select('id,studio_upload').in('id', items.map((i: { id: string }) => i.id)).not('studio_upload', 'is', null)
    if (!sErr) for (const r of (sRows ?? []) as Array<{ id: string; studio_upload: Record<string, unknown> | null }>) {
      if (r.studio_upload) studioByItem.set(r.id, studioDid(r.studio_upload, r.studio_upload.visibility != null))
      if (r.studio_upload && scoutSawPaidPromotion(r.studio_upload)) studioPaidByItem.add(r.id)
    }
  }

  // EACH BATCH'S CHANNEL, the one the creator confirmed with YouTube.
  const chRead = await channelsForBatches(sb, Array.from(new Set<string>(items.map((i: { batch_id: string }) => String(i.batch_id)))))
  // NOTHING UPLOADS ON A GUESS about which channel it goes to: next firing.
  if (chRead.failed) return { scheduled: 0, failed: 0 }
  const channelByBatch = chRead.map
  // What YouTube said each login uploads to, asked once per firing per batch.
  const liveByBatch = new Map<string, { id: string; title: string } | null>()

  // EACH BATCH'S NOTIFY TOGGLE (migration 366), read on its own so a missing
  // column cannot stop every upload. On any error the map is empty and every
  // batch reads as No. YouTube's default is to notify, so the value is always
  // sent explicitly below; this map only decides WHICH explicit value.
  const notifyByBatch = new Map<string, boolean>()
  {
    const batchIds = [...new Set(items.map((i: { batch_id: string }) => i.batch_id))]
    const { data: nb, error: nbErr } = await sb.from('launch_batches')
      .select('id,notify_subscribers').in('id', batchIds)
    if (!nbErr) {
      for (const b of (nb ?? []) as Array<{ id: string; notify_subscribers: boolean | null }>) {
        notifyByBatch.set(b.id, b.notify_subscribers === true)
      }
    }
  }

  // EACH BATCH'S PLAYLIST, and which videos are already in it (migration 367).
  // Read on their own, like the toggle above: before the SQL runs these
  // columns do not exist, and on any error no video is added to anything.
  // A video already recorded as added is never added twice, because YouTube
  // lets a playlist hold the same video more than once and a retried row
  // would do exactly that.
  const playlistByBatch = new Map<string, string>()
  const inPlaylist = new Set<string>()
  // WHETHER EACH BATCH ANSWERS THE DISCLOSURES (paid promotion Yes, AI use
  // No). The creator's own tick in the batch's YouTube options, on unless they
  // turned it off; a batch read before migration 367 answers them too.
  const discloseByBatch = new Map<string, boolean>()
  {
    const batchIds = [...new Set(items.map((i: { batch_id: string }) => i.batch_id))]
    const { data: pb, error: pbErr } = await sb.from('launch_batches')
      .select('id,playlist_id,studio_options').in('id', batchIds)
    if (!pbErr) {
      for (const b of (pb ?? []) as Array<{ id: string; playlist_id: string | null; studio_options: unknown }>) {
        if (b.playlist_id) playlistByBatch.set(b.id, b.playlist_id)
        discloseByBatch.set(b.id, normalizeStudioOptions(b.studio_options).disclosures)
      }
      const { data: pa, error: paErr } = await sb.from('launch_items')
        .select('id').in('id', items.map((i: { id: string }) => i.id)).not('playlist_added_at', 'is', null)
      if (paErr) playlistByBatch.clear()
      else for (const r of (pa ?? []) as Array<{ id: string }>) inPlaylist.add(r.id)
    }
  }

  // WHICH BATCHES ARE AMAZON ONLY (migration 369), read on its own so a
  // missing column cannot stop uploads: on any error every batch goes to
  // YouTube, which is what every batch did before the choice existed.
  const amazonOnlyBatches = new Set<string>()
  {
    const batchIds = [...new Set(items.map((i: { batch_id: string }) => i.batch_id))]
    const { data: ab, error: abErr } = await sb.from('launch_batches').select('id,send_to_youtube').in('id', batchIds)
    // ONLY A MISSING COLUMN MEANS "EVERY BATCH GOES TO YOUTUBE". Any other
    // failure to read the choice (a timeout, a blip) waits for the next
    // firing: guessing YouTube would upload and schedule a batch its creator
    // said must not go there.
    if (abErr && !(abErr.code === '42703' || /send_to_youtube/.test(String(abErr.message || '')))) {
      console.warn('[launch-drain] could not read which batches are Amazon only; waiting', { said: abErr.message })
      return { scheduled: 0, failed: 0 }
    }
    if (!abErr) for (const b of (ab ?? []) as Array<{ id: string; send_to_youtube: boolean | null }>) if (b.send_to_youtube === false) amazonOnlyBatches.add(b.id)
  }

  let scheduled = 0, failed = 0
  let budget = PUBLISHES
  const stamp = () => new Date().toISOString()

  for (const it of items) {
    if (budget <= 0) break
    const src = (it.rendered_url || '').trim()
    const title = (it.title || '').trim()
    if (!/^https:\/\//i.test(src) || !title) {
      // SAID, NOT SKIPPED. A row with no file or no title used to be passed
      // over in silence every firing, reading "Queued for upload" for ever
      // while it took a place in the list from rows that could go.
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: !title ? 'It has no title, so it cannot go out. Give it one and press Try again.' : 'Its finished video file is missing, so it cannot go out. Press Try again to prepare it again.',
        updated_at: stamp(),
      }).eq('id', it.id).eq('state', 'prepared').is('youtube_video_id', null)
      continue
    }

    // ── AMAZON ONLY: NOTHING GOES TO YOUTUBE ─────────────────────────────
    // Handed straight to the Amazon side under a placeholder id (the same
    // shape Video Launchpad used when a creator skipped YouTube). Claimed
    // first like everything else; a hand-over that fails is written on the
    // row and repairs() tries again every minute.
    if (amazonOnlyBatches.has(it.batch_id)) {
      // WHEN IT WAS HANDED OVER, as its date: with none, an Amazon-only video
      // never aged out of the background tab's work, and the coverage steps
      // gave it the lowest priority there is.
      const { data: took } = await sb.from('launch_items')
        .update({ state: 'amazon_only', publish_at: stamp(), reason: null, updated_at: stamp() })
        .eq('id', it.id).eq('state', 'prepared').select('id')
      if (!took || took.length === 0) continue
      const handed = await handOverToAmazon(sb, it, `upload-${it.id}`, null, stamp())
      await noteHandOver(sb, it.id, handed, true)
      scheduled++
      continue
    }

    // ── UPLOADED BY SCOUT IN YOUTUBE STUDIO, NOT HERE ────────────────────
    // For a creator with the Studio upload on (lib/studio-upload), the upload
    // costs 1,600 of the quota every account shares, so it is left to SCOUT,
    // which reports the new id to app/api/launch/studio-uploads. The row says
    // it is waiting for SCOUT; once it has an id it goes on below as usual.
    if (!String(it.youtube_video_id || '').trim() && usesStudioUpload(await ownerTier(sb, String(it.user_id)))) {
      // Said once, over nothing or over a note from the API's own waiting. A
      // reason SCOUT wrote (its last failure) stays on screen until it reports
      // again, so the creator sees why the last go did not work.
      const was = String(it.reason || '').trim()
      if (!isStudioWaiting(was) && !isStudioRunning(was) && (!was || /^(?:Waiting for YouTube|Attempt \d+ of \d+ is running now)/.test(was))) {
        const q = sb.from('launch_items').update({ reason: STUDIO_UPLOAD_WAITING, updated_at: stamp() })
          .eq('id', it.id).eq('state', 'prepared').is('youtube_video_id', null)
        await (it.reason == null ? q.is('reason', null) : q.eq('reason', it.reason))
      }
      continue
    }

    const tries = Number(it.publish_tries ?? 0)
    const said0 = String(it.reason || '').trim()
    // WAITING ON YOUTUBE: not asked again every minute. The shared allowance
    // is looked at every ten minutes (until the reset), a channel's own upload
    // limit hourly, and a creator whose channel hit it this run waits.
    if (capped.has(String(it.user_id))) continue
    if (/^Waiting/.test(said0) && it.updated_at) {
      const since = Date.now() - new Date(it.updated_at).getTime()
      if (since < (/own daily upload limit/.test(said0) ? 3_600_000 : 600_000)) continue
    }
    // ── ANOTHER FIRING IS UPLOADING THIS ONE ──────────────────────────────
    //
    // THE WAY A VIDEO COULD GO UP TWICE. Firings start every minute and run up
    // to five, and the upload writes its YouTube id only once YouTube hands it
    // over, minutes after it starts. A second firing meanwhile saw the same
    // row, prepared and with no id, and uploaded it again. A row marked
    // "running now" within the last five and a half minutes belongs to a
    // firing that is still alive; after that, the firing is dead and the row
    // goes round again as below.
    if (/^Attempt \d+ of \d+ is running now\./.test(said0) && it.updated_at
      && Date.now() - new Date(it.updated_at).getTime() < 330_000) continue
    if (tries >= TRIES) {
      // THE LAST REAL ERROR SURVIVES THE GIVING UP.
      //
      // Every attempt wrote YouTube's own words onto `reason`, and this line
      // used to overwrite them with a sentence that fits every cause equally
      // badly: a disconnected channel, a file YouTube rejected, a quota, a
      // strike. Four different answers, and the one piece of information that
      // told them apart was destroyed at the exact moment somebody went
      // looking for it.
      const said = String(it.reason || '').trim()
      // AN ATTEMPT THAT NEVER REPORTED BACK IS ITS OWN ANSWER, and a different
      // one from "YouTube said no". It means the firing was cut off before the
      // catch could run, which is a time problem and not a YouTube problem, and
      // quoting the note back as "the last thing it said" would hide that.
      const inflight = /^Attempt \d+ of \d+ is running now\./.test(said)
      const generic = inflight || /^YouTube would not take this video/.test(said)
      // ON THE CHANNEL ALREADY CHANGES THE ADVICE ENTIRELY. "Check the channel
      // is still connected" was printed over a video that had uploaded three
      // times, and sent its creator to look at the one thing that was working.
      const already = !!String(it.youtube_video_id || '').trim()
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: already
          ? `The video is on your channel, but its publish time could not be set after ${tries} tries${said && !generic ? `. The last thing YouTube said: ${said}` : ' and YouTube gave no reason we could read'}. It is sitting there private, so set the time on YouTube or press Try again.`.slice(0, 300)
          : inflight
            ? `${tries} upload attempts each stopped before they could report back, which is a time problem rather than a YouTube one. Press Try again, and tell support if it happens twice.`
            : said && !generic
              ? `YouTube refused this ${tries} times. The last thing it said: ${said}`.slice(0, 300)
              : `YouTube would not take this video after ${tries} tries, and gave no reason we could read. Check the channel is still connected under Settings.`,
        updated_at: stamp(),
      }).eq('id', it.id)
      failed++
      continue
    }
    // THE ATTEMPT IS RECORDED BEFORE IT RUNS, so a firing killed mid-upload
    // cannot retry forever, and the note says so plainly: a row still carrying
    // this sentence is a row whose attempt never came back to write anything.
    // ONLY WITH TIME TO FINISH, since an upload cut off part way is the one
    // outcome that can leave a video on YouTube with no record of it here.
    if (left() < 150_000) break
    // CLAIMED on the try count it was read with, so two firings reaching the
    // row in the same instant cannot both take it.
    const claim = sb.from('launch_items').update({
      publish_tries: tries + 1,
      // THE LAST TRY'S ERROR STAYS ON SCREEN. It used to be overwritten by
      // this note the moment the next attempt started, so a creator watched
      // "Attempt 2 of 3" become "Attempt 3 of 3" with no idea why.
      reason: `Attempt ${tries + 1} of ${TRIES} is running now.${/^Sending to YouTube in pieces/.test(said0) ? ` Carrying on: ${said0.replace(/ It carries on.*$/, '')}` : said0 && !/^Attempt \d+ of \d+ is running now\./.test(said0) && tries > 0 ? ` Last try: ${said0}` : /^Attempt \d+ of \d+ is running now\./.test(said0) && tries > 0 ? ' Last try stopped before it could report back, which is a time limit, not YouTube.' : ''}`.slice(0, 300),
      updated_at: stamp(),
    }).eq('id', it.id).eq('state', 'prepared')
    const { data: claimed } = await (it.publish_tries == null ? claim.is('publish_tries', null) : claim.eq('publish_tries', tries)).select('id')
    if (!claimed || claimed.length === 0) continue
    budget--

    try {
      const expected = channelByBatch.get(it.batch_id) ?? null
      const token = await getChannelOAuthToken(sb, it.user_id as string, expected)
      if (!token) throw new Error('your YouTube channel is not connected for publishing')

      const yt = new YouTubeOAuthService(token)

      // ── THE RIGHT CHANNEL, ASKED OF YOUTUBE, BEFORE ANY UPLOAD ───────────
      //
      // The creator confirmed a channel before launch. A login can change
      // since (reconnected on another account, a Brand Account picked
      // differently), so the login is asked again which channel it uploads to
      // before a single byte goes up. A mismatch stops this video with both
      // channel names on it; nothing is uploaded to the wrong channel.
      if (expected && !String(it.youtube_video_id || '').trim()) {
        if (!liveByBatch.has(it.batch_id)) {
          const me = await yt.getMyChannel()
          liveByBatch.set(it.batch_id, me ? { id: me.id, title: me.title } : null)
        }
        const live = liveByBatch.get(it.batch_id)
        if (!live || live.id !== expected) {
          const { data: named } = await sb.from('youtube_channels')
            .select('channel_title').eq('user_id', it.user_id).eq('channel_id', expected).maybeSingle()
          await sb.from('launch_items').update({
            state: 'blocked',
            reason: live
              ? wrongChannelMessage(String(named?.channel_title || expected), live.title)
              : 'YouTube says this login has no channel. Nothing was uploaded. Reconnect your channel under Settings.',
            updated_at: stamp(),
          }).eq('id', it.id)
          failed++
          continue
        }
      }

      // ── NOW, AT ITS MOMENT, OR NOT AT ALL ────────────────────────────────
      //
      // THIS USED TO READ THE CLOCK, and that published a video nobody asked
      // to publish. A creator set LACES STAY PUT for today at 17:00 and
      // pressed Launch while 17:00 was still ahead. The uploader reached it at
      // 18:09, saw a time in the past, decided that meant "now", and put it on
      // their channel publicly. At no point had anybody been told.
      //
      // "Now" is only a decision if it was true when the creator decided. The
      // launch route records exactly those videos (migration 365), the ones
      // the page warned about before the button. So:
      //
      //   agreed and due   upload PUBLIC. YouTube refuses a publishAt in the
      //                    past, so "now" is said by uploading public.
      //   due, not agreed  a slot we missed. Upload PRIVATE with no time, and
      //                    the row asks for a new one. Nothing goes public
      //                    unless somebody chose it.
      //   not due          upload PRIVATE, then set the time. Uploading public
      //                    and scheduling afterwards would put it on the
      //                    channel for however long the second call takes.
      const due = new Date(String(it.planned_publish_at)).getTime() <= Date.now()
      const goNow = due && agreedNow.has(it.id)
      let missed = due && !goNow

      // ── THE UPLOAD HAPPENS ONCE, EVER ────────────────────────────────────
      //
      // THE WORST THING THIS WORKER HAS DONE. A creator launched one video and
      // found three copies of it on their real channel, all stuck on "Pending,
      // processing will begin shortly", while this page said the upload had
      // failed. Every one of those three uploads SUCCEEDED. What failed was the
      // call after it, the one that sets the publish time, and the retry
      // started again from the top and uploaded the file afresh.
      //
      // So the id is written the moment YouTube hands it over, before anything
      // else is allowed to fail, and a row that already has one never uploads
      // again. A retry resumes at the step that broke. That is also why the
      // file is fetched inside this branch: a resumed row has no reason to
      // download half a gigabyte it is not going to send.
      const disclose = discloseByBatch.get(it.batch_id) !== false
      let videoId = String(it.youtube_video_id || '').trim()
      let channelId: string | null = null
      if (!videoId) {
        // Refuse on the header before pulling the body into memory, the same
        // way the interactive uploader does. Downloading half a gigabyte to
        // discover it is half a gigabyte is the check becoming the problem.
        // BIG VIDEOS GO IN PIECES, ACROSS RUNS (migration 396). One request
        // has the five minutes of one run, and a 288MB video could not make it:
        // all three tries "stopped before they could report back". A YouTube
        // upload session is opened once and kept on the row, the file goes in
        // 32MB pieces read straight from storage, and a run that runs low on
        // time saves where it got to and gives the try back. The next run
        // carries on from there. Small videos keep the one-request path.
        const openOpts = {
          title: title.slice(0, 100),
          description: (it.description || '').slice(0, 4900),
          tags: String(it.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
          privacyStatus: 'private' as const,
          notifySubscribers: notifyByBatch.get(it.batch_id) === true,
          embeddable: true,
          ...(disclose ? { containsSyntheticMedia: false } : {}),
        }
        let total = 0
        if (piecesOn) {
          const head = await fetchWithTimeout(src, { method: 'HEAD', timeoutMs: 20_000 }).catch(() => null)
          total = Number(head?.headers.get('content-length') || 0)
        }
        if (piecesOn && total > 0 && (ytSessions.has(it.id) || total > PIECES_FROM)) {
          if (total > MAX_UPLOAD_BYTES) throw new Error('this video is too large for YouTube')
          const sent = await sendInPieces(sb, yt, it.id, src, total, ytSessions.get(it.id) ?? null, openOpts, left)
          if (!sent.done) {
            // PROGRESS IS NOT A FAILED TRY: the try is handed back, and the
            // note says how far it got. The next run carries on.
            // ONLY WHEN IT MOVED. A run that sent nothing new keeps the try it
            // used, so an upload that is stuck cannot go round forever.
            const before = Number((/^Sending to YouTube in pieces: (\d+) of/.exec(said0) ?? [])[1] ?? -1)
            const moved = Math.round(sent.sent / 1048576) > before
            await sb.from('launch_items').update({
              publish_tries: moved ? tries : tries + 1,
              reason: `Sending to YouTube in pieces: ${Math.round(sent.sent / 1048576)} of ${Math.round(total / 1048576)} MB so far. It carries on by itself on the next run.`,
              updated_at: stamp(),
            }).eq('id', it.id)
            continue
          }
          videoId = sent.id
          channelId = sent.channelId
        } else {
          const res = await fetchWithTimeout(src, { timeoutMs: Math.max(30_000, Math.min(240_000, left() - 90_000)) })
          if (!res.ok) throw new Error(`the video file could not be read (${res.status})`)
          const declared = Number(res.headers.get('content-length') || 0)
          if (declared && declared > MAX_UPLOAD_BYTES) throw new Error('this video is too large for YouTube')
          const bytes = Buffer.from(await res.arrayBuffer())
          if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('this video is too large for YouTube')

          const up = await yt.uploadShort(bytes, {
            title: title.slice(0, 100),
            // THE AFFILIATE LINK LIVES IN HERE. Written by the prepare step from
            // the same writer Launchpad uses, because the CTA burned into this
            // very frame says "link in the description" and an empty one makes
            // that a lie and the video unpaid.
            description: (it.description || '').slice(0, 4900),
            tags: String(it.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
            // PRIVATE ALWAYS, even for a video going out now: it becomes public
            // only once its paid promotion has been set and read back, below.
            privacyStatus: 'private',
            // The batch's toggle, sent explicitly: left out, YouTube notifies.
            notifySubscribers: notifyByBatch.get(it.batch_id) === true,
            embeddable: true,
            ...(disclose ? { containsSyntheticMedia: false } : {}),
            // What is left of this firing, less room to record the id.
            uploadTimeoutMs: left() - 20_000,
          })
          videoId = up.id
          channelId = up.channelId
        }
        // IMMEDIATELY, AND ON ITS OWN. Not bundled into the update at the end
        // of this block: everything between here and there is a way for this
        // fact to be lost, and losing it is what put three copies on a channel.
        // CHECKED, AND TRIED AGAIN. A write that failed in silence here is a
        // second upload on the next firing. Three goes, then it is logged;
        // the update at the end of this block writes the id once more.
        for (let w = 0; w < 3; w++) {
          // The upload session is cleared IN THE SAME WRITE as the id. Cleared
          // first, a run that died between the two left a row with neither,
          // and the next run uploaded the whole video again. Kept until the id
          // is safe, the next run asks the session and gets the id back.
          const { error: idErr } = await sb.from('launch_items')
            .update({ youtube_video_id: videoId, updated_at: stamp(), ...(piecesOn ? { yt_upload_url: null } : {}) }).eq('id', it.id)
          if (!idErr) break
          console.error('[launch-drain] could not record the YouTube id', { item: it.id, videoId, said: idErr.message, attempt: w + 1 })
          await new Promise((r) => setTimeout(r, 1000 * (w + 1)))
        }
      }

      // The batch's zone, only when it is needed for a kept-private note.
      let missedZone: string | null = null
      if (missed || disclose) {
        const { data: zb } = await sb.from('launch_batches').select('timezone').eq('id', it.batch_id).maybeSingle()
        missedZone = zb?.timezone ?? null
      }

      // ── THE DISCLOSURES, THROUGH YOUTUBE'S OWN API ──────────────────────
      //
      // Paid promotion and the AI-use answer used to be set only by SCOUT in a
      // browser, after the fact, so a batch video could go public undisclosed.
      // YouTube's API takes both now (paidProductPlacementDetails and
      // status.containsSyntheticMedia), so they are set here, the moment the
      // video exists, and read back below. A failure is written on the row;
      // it never loses the upload.
      // PAID PROMOTION CANNOT BE SET HERE. This used to call
      // videos.update with part=paidProductPlacementDetails, and YouTube
      // accepted the call and changed nothing: that part is readable, not
      // writable (YouTube's videos.update lists what an app may set, and it is
      // not there). Every batch video read back No and was held. Only Studio
      // can set it (SCOUT's Studio step, or the creator), and heldForDisclosure
      // below schedules the video once it reads back Yes.
      let discloseError: string | null = null
      // EVERY STATUS PUT RESENDS EVERYTHING IT MUST KEEP. YouTube erases any
      // status field a PUT leaves out, and the scheduling call used to send the
      // time alone: that is what switched "Allow embedding" off and dropped the
      // made-for-kids answer on every batch video.
      const keep = {
        madeForKids: false,
        embeddable: true,
        ...(disclose ? { containsSyntheticMedia: false } : {}),
      }

      // ── READ BACK WHAT YOUTUBE KEPT, BEFORE ANY TIME IS SET ─────────────
      //
      // THE DISCLOSURE GATES THE SCHEDULE TOO, not only "now". This read used
      // to come after the publish time was set, so a video whose paid
      // promotion YouTube did not confirm was scheduled anyway and went public
      // undisclosed at its time. Now it is kept private with no time, and the
      // row says why and what to do; a new time and Launch these too resumes
      // it from here, without uploading it again.
      let readBack: Awaited<ReturnType<typeof yt.readDisclosures>> = null
      try { readBack = await yt.readDisclosures(videoId) } catch (re) {
        discloseError = discloseError ?? `could not read the video back: ${(re instanceof Error ? re.message : String(re)).slice(0, 160)}`
      }
      // WHEN YOUTUBE CANNOT BE ASKED, STUDIO'S OWN READING COUNTS. On a day
      // the shared quota is used up the read above fails, and every video SCOUT
      // had disclosed and scheduled in Studio was held private on a read that
      // never happened (Seb, 2026-10-05: "it did the same thing" on every
      // retry). SCOUT reads Paid promotion and the schedule back from Studio's
      // saved state at no quota; that answers when the API cannot. An API read
      // that does answer still decides, both ways.
      const apiBlind = readBack == null
      const paidConfirmed = !disclose || readBack?.paidPromotion === true || (apiBlind && studioPaidByItem.has(it.id))
      // SCHEDULED BY SCOUT FOR ITS OWN TIME, read back from YouTube: still
      // private with that time, or already public because the time came
      // before this run reached it. Either way the slot was kept, not missed.
      const viaStudio = studioByItem.get(it.id) ?? null
      const studioOnTime = !!viaStudio && viaStudio.visibility === 'schedule' && !!viaStudio.publishAt
        && Math.abs(Date.parse(viaStudio.publishAt) - Date.parse(String(it.planned_publish_at))) <= 120_000
        && ((apiBlind && viaStudio.scheduleVerified) || scheduleHeld(viaStudio, readBack, String(it.planned_publish_at)) || readBack?.privacyStatus === 'public')
      if (studioOnTime && paidConfirmed) missed = false
      let heldBack: string | null = null
      if (!missed && !paidConfirmed) {
        heldBack = (goNow
          ? `Kept private. YouTube did not confirm paid promotion on it${discloseError ? ` (${discloseError})` : ''}, so it was not made public. YouTube only takes paid promotion in Studio: once Studio has it (SCOUT's Studio step, or ticked by hand), give it a time and press Launch these too, or make it public in Studio.`
          : `Kept private. YouTube did not confirm paid promotion on it${discloseError ? ` (${discloseError})` : ''}, so it is not scheduled yet. YouTube only takes paid promotion in Studio: once Studio has it (SCOUT's Studio step, or ticked by hand), MVP schedules it for ${missedWhen(String(it.planned_publish_at), missedZone)} on its own.`
        ).slice(0, 400)
      }

      // ── WHAT SCOUT DID IN STUDIO, CHECKED, NOT TAKEN ON TRUST ────────────
      // A video SCOUT uploaded may already be scheduled, public, in its
      // playlist and wearing its thumbnail, all at no quota. The schedule and
      // the visibility are confirmed by the read above (1 unit); anything
      // SCOUT did not do, or that does not read back, is done here as before.
      const studioScheduled = !goNow && !missed && !heldBack && studioOnTime
      const studioPublic = goNow && !heldBack && viaStudio?.visibility === 'public' && readBack?.privacyStatus === 'public'
      // NEVER OUT WITHOUT ITS DISCLOSURE. If YouTube does not confirm paid
      // promotion on a video SCOUT scheduled or published, it is made private
      // here, whatever Studio showed.
      if ((!paidConfirmed || missed) && viaStudio && viaStudio.visibility && viaStudio.visibility !== 'private'
        && (!readBack || readBack.privacyStatus !== 'private' || !!readBack.publishAt)) {
        try {
          await yt.updateVideoStatus(videoId, { privacyStatus: 'private', notifySubscribers: notifyByBatch.get(it.batch_id) === true, ...keep })
        } catch (pe) {
          const said = pe instanceof Error && pe.message ? pe.message : String(pe)
          throw new Error(`SCOUT scheduled it in Studio, but YouTube did not confirm paid promotion, and MVP could not make it private again: ${said}`)
        }
      }

      if (!goNow && !missed && !heldBack && !studioScheduled) {
        // THE SCHEDULE ITSELF, and its result is what decides whether this row
        // may call itself scheduled. A failure here is now said in the terms
        // that matter to somebody looking at their channel: the video is on it.
        try {
          // THE BATCH'S TOGGLE. This line used to pass `true` for every Launch
          // Batch video, with no toggle anywhere, so every scheduled batch
          // video rang the bell when it went public.
          await yt.updateVideoStatus(videoId, {
            publishAt: String(it.planned_publish_at),
            notifySubscribers: notifyByBatch.get(it.batch_id) === true,
            ...keep,
          })
        } catch (se) {
          const said = se instanceof Error && se.message ? se.message : String(se)
          throw new Error(`the video is on your channel but YouTube would not set its publish time: ${said}`)
        }
      }

      // ── THE THUMBNAIL WE DESIGNED, ON THE VIDEO ──────────────────────────
      //
      // This step did not exist. Every batch built a thumbnail, stored it,
      // showed it on the board and gave the clean copy to Amazon, and then
      // uploaded to YouTube without setting it, so the channel ran whichever
      // frame YouTube picked. The board looked right because it shows the file
      // we made, not the one on the video.
      //
      // IT NEVER FAILS THE UPLOAD. The video is on the channel by this point,
      // and throwing here would send the row back for a retry that uploads it
      // a second time. What it must not do is fail quietly, so the outcome is
      // written either way and the board reads it.
      // ── (FOR "NOW") GO PUBLIC, ONLY WITH THE DISCLOSURE IN PLACE ────────
      if (goNow && !heldBack && !studioPublic) {
        try {
          await yt.updateVideoStatus(videoId, {
            privacyStatus: 'public',
            notifySubscribers: notifyByBatch.get(it.batch_id) === true,
            ...keep,
          })
        } catch (ge) {
          const said = ge instanceof Error && ge.message ? ge.message : String(ge)
          throw new Error(`the video is on your channel, private, but YouTube would not make it public: ${said}`)
        }
      }
      // Recorded on its own, so a database without migration 368 loses the
      // record and nothing else.
      await sb.from('launch_items').update({
        api_disclosures: {
          at: stamp(), asked: disclose,
          paidPromotion: readBack?.paidPromotion ?? null,
          // SILENT IS NOT "YES". YouTube often leaves the AI question out of
          // its answer; that read as "not No" and drew a red cross beside a
          // video Studio had just read back as AI use: No. aiUse keeps what
          // YouTube actually said (true, false, or null for nothing).
          aiUseNo: readBack && readBack.containsSyntheticMedia != null ? readBack.containsSyntheticMedia === false : null,
          aiUse: readBack?.containsSyntheticMedia ?? null,
          embeddable: readBack?.embeddable ?? null,
          madeForKids: readBack?.madeForKids ?? null,
          error: discloseError,
        },
      }).eq('id', it.id)

      const thumbSrc = String(it.thumbnail_url || '').trim()
      const thumb: { at: string | null; error: string | null } = { at: null, error: null }
      if (/^https:\/\//i.test(thumbSrc) && viaStudio?.thumbnail === true && viaStudio.thumbVerified) {
        // SCOUT set it in Studio and saw its own image in Studio's thumbnail
        // box. (SCOUT 1.26.0 counted any new preview in the dialog and called
        // a missing thumbnail set, so its word alone is not taken.)
        thumb.at = stamp()
      } else if (/^https:\/\//i.test(thumbSrc)) {
        try {
          const tr = await fetchWithTimeout(thumbSrc, { timeoutMs: 60_000 })
          if (!tr.ok) throw new Error(`the thumbnail file could not be read (${tr.status})`)
          const type = tr.headers.get('content-type') || 'image/jpeg'
          await yt.uploadThumbnail(videoId, Buffer.from(await tr.arrayBuffer()), type)
          thumb.at = stamp()
        } catch (te) {
          thumb.error = (te instanceof Error && te.message ? te.message : String(te)).slice(0, 200)
          console.warn('[launch-drain] thumbnail refused', { item: it.id, said: thumb.error })
        }
      } else {
        thumb.error = 'there was no designed thumbnail to set, so YouTube picked a frame'
      }

      // ── THE PLAYLIST THE CREATOR PICKED ──────────────────────────────────
      // Same rule as the thumbnail: it never fails the upload, and it never
      // fails quietly. The answer is written on its own, so a database without
      // migration 367 loses the note and nothing else.
      const playlist = playlistByBatch.get(it.batch_id)
      if (playlist && !inPlaylist.has(it.id)) {
        let added: string | null = null, plError: string | null = null
        try {
          // SCOUT picked it in Studio and read it back off the dropdown.
          if (viaStudio?.playlist !== true) await yt.addVideoToPlaylist(playlist, videoId)
          added = stamp()
        } catch (pe) {
          plError = (pe instanceof Error && pe.message ? pe.message : String(pe)).slice(0, 200)
          console.warn('[launch-drain] playlist refused', { item: it.id, said: plError })
          // Out of YouTube's daily allowance is not a refusal: left unrecorded,
          // so the playlist catch-up adds it after the reset.
          if (/quotaExceeded|dailyLimitExceeded/i.test(plError)) plError = null
        }
        await sb.from('launch_items').update({ playlist_added_at: added, playlist_error: plError }).eq('id', it.id)
      }

      // ── THE PINNED FIRST COMMENT, EVERY VIDEO (Labs) ─────────────────────
      // Liftoff never had one, while Co-Pilot always did. Queued the moment
      // the video exists; the first-comments cron posts it when YouTube shows
      // the video as public, and SCOUT pins it from the browser. Never fails
      // the upload, and a retried row never gets a second one.
      if (left() > 30_000) {
        try {
          const tier = await ownerTier(sb, it.user_id)
          if (canUsePreview('first_comment', tier)) {
            const q = await queueFirstComment(sb, {
              userId: it.user_id, tier, youtubeVideoId: videoId, channelId,
              title, description: it.description ?? null,
              publishAt: goNow ? stamp() : heldBack || missed ? null : it.planned_publish_at,
            })
            if (!q.queued && q.why !== 'already') console.warn('[launch-drain] first comment not queued', { item: it.id, why: q.why, detail: q.detail })
          }
        } catch (fe) {
          console.warn('[launch-drain] first comment not queued', { item: it.id, said: fe instanceof Error ? fe.message : String(fe) })
        }
      }

      await sb.from('launch_items').update({
        thumbnail_set_at: thumb.at,
        thumbnail_error: thumb.error,
        // PUBLISHED, NOT SCHEDULED, when it went out now. They are different
        // facts and the row has always kept them apart; collapsing them here
        // would have the board promising a future publication for a video that
        // is already on the channel.
        // A MISSED SLOT IS NOT A SCHEDULE. It is on the channel, private, with
        // no publish time, and the row says so and says what to do. Calling it
        // 'scheduled' would promise a publication nothing has arranged.
        state: heldBack ? 'blocked' : goNow ? 'published' : missed ? 'blocked' : 'scheduled',
        youtube_video_id: videoId,
        // THE MOMENT IT ACTUALLY WENT, not the slot that had gone by. A row
        // saying it published at nine this morning, written at two in the
        // afternoon, is the plan reported as the result.
        publish_at: heldBack ? null : goNow ? stamp() : missed ? null : it.planned_publish_at,
        reason: heldBack ? heldBack : missed
          ? `Kept private. Its time, ${missedWhen(String(it.planned_publish_at), missedZone)}, passed while it was still waiting to upload, so it was not made public. Set a publish time for it in YouTube Studio.`
          : null,
        updated_at: stamp(),
      }).eq('id', it.id)

      const handed = await handOverToAmazon(sb, it, videoId, channelId, goNow ? stamp() : it.planned_publish_at)
      // Not overwriting the kept-private note with a hand-over note: the
      // private one is the thing the creator has to act on.
      if ((missed || heldBack) && !handed.ok) { scheduled++; continue }
      await noteHandOver(sb, it.id, handed)
      scheduled++
    } catch (e) {
      // YOUTUBE'S DAILY ALLOWANCE IS NOT A FAILED TRY. The quota is shared by
      // every MVP account and resets at midnight Pacific; this video did
      // nothing wrong. It used to burn a try per firing, so within minutes
      // every queued video across every batch was blocked for good. Now the
      // try is handed back, the row says what it is waiting for, and this
      // firing stops publishing (the next video would get the same answer).
      const msg = e instanceof Error ? e.message : String(e)
      if (/quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/i.test(msg)) {
        const channelCap = /uploadLimitExceeded/i.test(msg)
        await sb.from('launch_items').update({
          publish_tries: tries,
          reason: channelCap
            ? 'Waiting: YouTube says this channel has reached its own daily upload limit. MVP carries on by itself tomorrow.'
            : 'Waiting for YouTube’s daily allowance, which every MVP account shares, to reset at midnight Pacific. MVP carries on by itself after that; nothing to do.',
          updated_at: stamp(),
        }).eq('id', it.id)
        // ONE CHANNEL'S OWN LIMIT IS ONE CHANNEL'S. Stopping the pass here
        // stalled every other creator's uploads behind it all day; only this
        // creator's other videos wait. The shared allowance stops everyone.
        if (channelCap) { capped.add(String(it.user_id)); continue }
        break
      }
      // LEFT PREPARED so the next firing tries again, with the reason on the
      // row rather than in a log nobody reads.
      // THE FALLBACK USED TO BE THE GENERIC SENTENCE ITSELF, word for word, so
      // a throw that was not an Error wrote the very string the give-up path
      // treats as "no reason we could read" and then discards. Two layers
      // agreeing to say nothing. Whatever was thrown gets written now, even
      // when it is not an Error, because an ugly string beats a blank.
      await sb.from('launch_items').update({
        reason: (e instanceof Error && e.message
          ? e.message
          : `YouTube refused it and the error was ${String(e).slice(0, 120)}`).slice(0, 200),
        updated_at: stamp(),
      }).eq('id', it.id)
      failed++
    }
  }
  return { scheduled, failed }
}

/**
 * Hand a video that is on YouTube to the Amazon side.
 *
 * NO SECOND PIPELINE. A video on YouTube is an ordinary video, so it gets a
 * youtube_videos row and a coverage cell per country the batch picked, and the
 * existing grid does the rest: the product check, the translation, the dub, and
 * the queue SCOUT uploads from.
 *
 * ── IT HAD NEVER WORKED, AND NOTHING SAID SO ──────────────────────────────
 *
 * The upsert named `onConflict: 'youtube_video_id'`, but the table's unique key
 * is (user_id, youtube_video_id), and Postgres refuses a conflict target that
 * matches no unique key. It also never supplied `channel_title`, which the
 * table declares NOT NULL. Either one alone fails every insert.
 *
 * And the failure was invisible by construction. The upsert returned
 * `data: null`, the next line read that as "nothing to do" and returned, and
 * the whole function sat inside a catch that swallowed anything else. Its
 * comment promised "the grid can be seeded on a later pass"; there was no
 * later pass. So every launched video reached YouTube, was never linked, and
 * the page beside it said "Nothing is on YouTube yet, so there is no video for
 * Amazon to list" about a video that was live on the channel. The first
 * creator to launch a batch found that sentence under a video they could see.
 *
 * NOW: the right conflict key, a channel title, a RESULT rather than a void,
 * a note on the row when it fails, and repairs() below, which retries every
 * firing until it lands. It still never fails the publish: the video is on
 * YouTube by now, and throwing would send it round the upload loop.
 */
type HandOver = { ok: true } | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handOverToAmazon(sb: Sb, it: any, videoId: string, channelId: string | null, publishedAt?: string | null): Promise<HandOver> {
  try {
    const { data: batch } = await sb.from('launch_batches')
      .select('markets').eq('id', it.batch_id).maybeSingle()
    // The US store only, even for a batch saved with more before Liftoff
    // stopped sending other countries (lib/launch-batch liftoffMarkets).
    const markets: string[] = liftoffMarkets((batch?.markets ?? []).filter((d: string) => !!marketByDomain(d)))
    // NO COUNTRIES IS NOT NOTHING TO DO. Liftoff part 1 (and a YouTube only
    // batch) still records the video, its clean original and its Amazon
    // title, so part 2 has everything it needs when Start Amazon is pressed.
    // Only the country rows wait (below).

    // THE CHANNEL'S NAME, borrowed from any row we already hold for the same
    // channel. The upload call returns the channel id but not its title, and
    // the column is NOT NULL. An empty string is what the other writer of this
    // table uses when it does not know, and the channel sync overwrites it
    // with the real name the next time it runs.
    let channelTitle = ''
    const channel = channelId || null
    if (channel) {
      const { data: known } = await sb.from('youtube_videos')
        .select('channel_title').eq('user_id', it.user_id).eq('channel_id', channel)
        .not('channel_title', 'is', null).neq('channel_title', '').limit(1).maybeSingle()
      channelTitle = String(known?.channel_title ?? '')
    }

    const { data: video, error: upsertErr } = await sb.from('youtube_videos').upsert({
      user_id: it.user_id,
      youtube_video_id: videoId,
      title: it.title,
      channel_id: channel || 'unknown',
      channel_title: channelTitle,
      // WHEN IT ACTUALLY WENT, when that is known. A video sent out "now" at
      // 18:09 against a 17:00 slot published at 18:09.
      published_at: publishedAt || it.publish_at || it.planned_publish_at,
      thumbnail_url: it.thumbnail_url ?? null,
      thumbnail_clean_url: it.thumbnail_clean_url ?? null,
      duration_seconds: it.duration_seconds ?? null,
      asin: it.asin ?? null,
      // THE CLEAN COPY, NEVER THE RENDERED ONE. The CTA is a YouTube device:
      // it says "link in the description", and a storefront listing has no
      // description and no link, so a burned-in one points at nothing.
      //
      // Deliberately NOT falling back to `rendered_url` when this is missing.
      // That fallback would put the CTA on Amazon, which is the exact thing
      // this column exists to prevent, and it would do it silently. A null
      // here means the storefront queue skips the market and names it, which
      // is the visible failure rather than the invisible wrong one.
      source_video_url: it.clean_url ?? null,
      description: it.description ?? null,
    }, { onConflict: 'user_id,youtube_video_id' }).select('id').single()
    if (upsertErr || !video?.id) {
      return { ok: false, error: upsertErr?.message || 'the video record came back empty' }
    }
    // The original kept for Clip Factory (migration 389): the Clip Factory
    // clean-up clears source_video_url after a day, this record it leaves alone.
    if (it.clean_url) {
      try { await sb.from('video_masters').upsert({ user_id: it.user_id, youtube_video_id: videoId, file_url: it.clean_url, source: 'liftoff' }, { onConflict: 'user_id,youtube_video_id' }) } catch { /* table absent pre-389 */ }
    }

    // THE STOREFRONT'S OWN TITLE rides with the video to the Amazon side,
    // where the localizing step prefers it over the YouTube title. Its own
    // write, so a database without migration 370 hands over as it always did.
    const amazonTitle = await ensureAmazonTitle(sb, it.id, it.user_id, it.asin ?? null, String(it.title || ''))
    if (amazonTitle) {
      await sb.from('youtube_videos').update({ amazon_title: amazonTitle }).eq('id', video.id)
    }

    if (markets.length > 0) {
    // THE COUNTRIES FIRST, THEN THE LINK. The link (video_id) used to be
    // written first, and the retry pass only picks rows with no video_id, so
    // a video whose country rows then failed to write was never tried again,
    // under a note promising it would be. Both writes are safe to repeat.
    const priority = coveragePriority({ publishedAt: publishedAt || it.publish_at || it.planned_publish_at })
    // EACH COUNTRY'S OWN ASIN, when the countries step found the product
    // there under a different one (lib/regional-listing, cached, no Keepa
    // spent here). Uploaded against the US ASIN, that country would be
    // blocked as "not sold" and only found again later by the coverage drain.
    const local = it.asin ? await cachedLocalAsins(sb, String(it.asin), markets) : new Map<string, string>()
    const { error: gridErr } = await sb.from('storefront_coverage').upsert(
      markets.map((domain) => ({
        user_id: it.user_id, video_id: video.id, domain,
        state: 'unknown', asin: local.get(domain) ?? it.asin ?? null, priority,
      })),
      { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true },
    )
    if (gridErr) return { ok: false, error: gridErr.message }
    }

    const { error: linkErr } = await sb.from('launch_items')
      .update({ video_id: video.id }).eq('id', it.id)
    if (linkErr) return { ok: false, error: linkErr.message }
    // ONLY THE HAND-OVER'S OWN NOTE IS CLEARED. This used to clear any reason,
    // and a video kept private after a missed slot lost the one sentence
    // telling its creator to give it a new time, the moment Amazon linked up.
    await sb.from('launch_items').update({ reason: null })
      .eq('id', it.id).like('reason', '%could not be passed to the Amazon side%')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Say on the row that the hand-over did not land, in its own words. The video
 *  is on YouTube and the row's state says so; this is a note on a working row,
 *  and it names the next attempt so it does not read as the end. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function noteHandOver(sb: Sb, id: string, r: HandOver, amazonOnly = false): Promise<void> {
  if (r.ok || !('error' in r)) return
  // NEVER OVER A KEPT-PRIVATE NOTE. The repair pass retries blocked rows too,
  // and each failed retry used to replace "Kept private. Its time passed..."
  // (the thing the creator has to act on) with a note about Amazon.
  const { data: cur } = await sb.from('launch_items').select('reason').eq('id', id).maybeSingle()
  const was = String(cur?.reason ?? '')
  if (/^Kept private\./.test(was)) return
  const note = amazonOnly
    ? `It could not be passed to the Amazon side yet: ${r.error}. MVP tries again every minute.`
    : `On YouTube, but it could not be passed to the Amazon side yet: ${r.error}. MVP tries again every minute.`
  const q = sb.from('launch_items').update({ reason: note.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', id)
  // Written only over what was read, so a note that changed meanwhile wins.
  await (cur?.reason == null ? q.is('reason', null) : q.eq('reason', was))
}

/**
 * The later pass the hand-over always promised and never had.
 *
 * Videos that are on YouTube (scheduled or published, with a YouTube id) and
 * were never linked to the Amazon side. Every one launched before the
 * hand-over was fixed is in this state, and so is any one whose hand-over
 * fails from here on. Cheap when there is nothing to do: one indexed select.
 */
const REPAIRS = 10
async function repairs(sb: Sb): Promise<{ linked: number; failed: number }> {
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,state,title,description,asin,thumbnail_url,thumbnail_clean_url,duration_seconds,clean_url,planned_publish_at,publish_at,youtube_video_id,reason')
    // BLOCKED TOO, when it is on YouTube: a video kept private after a missed
    // slot is still a video, and its Amazon listings do not wait for YouTube.
    // Its hand-over failing once used to mean it never reached Amazon at all.
    .in('state', ['scheduled', 'published', 'blocked', 'amazon_only'])
    .or('youtube_video_id.not.is.null,state.eq.amazon_only')
    .is('video_id', null)
    .order('updated_at', { ascending: true })
    .limit(REPAIRS * 5)
  const candidates = rows ?? []
  if (candidates.length === 0) return { linked: 0, failed: 0 }

  // EVERY BATCH IS REPAIRED, with or without the US store: the hand-over also
  // records the video and its clean original, which Liftoff part 2 (Start
  // Amazon) needs. Filtering to batches with markets after the limit let
  // fifty unrepairable rows hold every slot, and part 1 videos were never
  // linked, so "joins Amazon within a minute" never came true.
  let linked = 0, failed = 0
  for (const it of candidates.slice(0, REPAIRS)) {
    // The channel id is not stored on the row, so the title lookup falls back
    // to empty here; the channel sync fills it in later.
    // Amazon-only videos have no YouTube id; they use the same placeholder
    // the first hand-over did, so the retry lands on the same record.
    const r = await handOverToAmazon(sb, it, String(it.youtube_video_id || `upload-${it.id}`), null, it.publish_at)
    if (r.ok) linked++
    else {
      failed++
      await noteHandOver(sb, it.id, r, it.state === 'amazon_only')
      // To the back of the line whatever the note did, so one row that cannot
      // be repaired never holds the front. Not a kept-private row: its paid
      // promotion check counts ten minutes from its last change, and a bump
      // every minute would stop that check from ever running.
      if (!/^Kept private\./.test(String((it as { reason?: string | null }).reason ?? ''))) {
        await sb.from('launch_items').update({ updated_at: new Date().toISOString() }).eq('id', it.id)
      }
    }
  }
  return { linked, failed }
}

/** Move a batch's own state to match its videos, so the page does not have to
 *  work it out and cannot disagree. */
/** Scheduled videos whose moment has passed, checked per firing. Cheap: one
 *  YouTube call covers up to fifty ids. */
const CONFIRMS = 40
/** How long after the planned moment to start asking. YouTube does not flip a
 *  video to public on the second, and asking too early would write "it did not
 *  publish" about one that is thirty seconds away. */
const CONFIRM_GRACE_MS = 5 * 60_000
/** How many times to ask before saying on the row that it did not go out. */
const CONFIRM_TRIES = 6

/**
 * Did the scheduled videos actually go public?
 *
 * THIS STEP DID NOT EXIST, AND ITS ABSENCE WAS INVISIBLE. `publishes` above
 * writes `state: goNow ? 'published' : 'scheduled'` once, at upload, and
 * nothing came back afterwards. A video scheduled for Tuesday read "Scheduled
 * on YouTube, goes live 23 Sept 11:30" on Tuesday, on Wednesday and next month,
 * in green, whether or not YouTube ever made it public.
 *
 * And YouTube does fail to. A video can still be processing, be age-restricted,
 * or take a copyright claim, and the publishAt quietly does not fire. Every one
 * of those looked exactly like success, because the only thing the screen knew
 * was what we had ASKED for.
 *
 * 'published' was also unreachable for a scheduled video: only the publish-now
 * path ever wrote it. So the board had a state it could never show for the
 * videos most likely to need it.
 */
async function confirms(sb: Sb): Promise<{ published: number; late: number }> {
  const cutoff = new Date(Date.now() - CONFIRM_GRACE_MS).toISOString()
  // ── NOT THE SAME LATE VIDEOS FOREVER ──────────────────────────────────
  // A video past its checks used to stay first in line every firing, oldest
  // first, forty at a time across every creator, so a handful of removed or
  // never-published videos took every slot and newer ones were never
  // confirmed. Now the first CONFIRM_TRIES checks run every firing, after that
  // once an hour, and the line rotates on when each was last looked at.
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString()
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,title,youtube_video_id,publish_at,confirm_tries')
    .eq('state', 'scheduled')
    .not('youtube_video_id', 'is', null)
    .lte('publish_at', cutoff)
    .or(`confirm_tries.is.null,confirm_tries.lt.${CONFIRM_TRIES},updated_at.lt.${hourAgo}`)
    .order('updated_at', { ascending: true }).limit(CONFIRMS)
  const items = rows ?? []
  if (items.length === 0) return { published: 0, late: 0 }

  // GROUPED BY CREATOR, because the token is per account and one call takes
  // fifty ids. Checking forty videos costs at most a handful of requests.
  // AND BY CHANNEL: a private video is only visible to the channel it is on,
  // so asking with the default channel's login about a video on another of
  // the creator's channels would read as "YouTube no longer has this video".
  const confirmRead = await channelsForBatches(sb, Array.from(new Set<string>(items.map((i: { batch_id: string }) => String(i.batch_id)))))
  // A wrong login would read every private video as gone: wait instead.
  if (confirmRead.failed) return { published: 0, late: 0 }
  const confirmChannel = confirmRead.map
  const byUser = new Map<string, typeof items>()
  for (const it of items) {
    const k = `${it.user_id}|${confirmChannel.get(it.batch_id) ?? ''}`
    const list = byUser.get(k) ?? []
    list.push(it)
    byUser.set(k, list)
  }

  let published = 0, late = 0
  const stamp = () => new Date().toISOString()

  for (const [groupKey, list] of byUser) {
    const [userId, groupChannel] = groupKey.split('|')
    let meta: Record<string, { status: string; publishAt: string | null }> = {}
    try {
      const token = await getChannelOAuthToken(sb, userId, groupChannel || null)
      if (!token) {
        // Moved to the back of the line, so a disconnected channel does not
        // hold every other creator's confirmations up.
        await sb.from('launch_items').update({ updated_at: stamp() }).in('id', list.map((i: { id: string }) => i.id))
        continue
      }
      meta = await new YouTubeOAuthService(token).getVideoMetaByIds(
        list.map((i: { youtube_video_id: string }) => i.youtube_video_id),
      )
    } catch (e) {
      // A CHECK THAT COULD NOT RUN IS NOT A VERDICT. Leaving the rows alone
      // means the next firing tries again, which is the opposite of writing
      // "it did not publish" because our own call failed.
      console.warn('[launch-drain] confirm lookup failed', { userId, said: e instanceof Error ? e.message : String(e) })
      continue
    }

    for (const it of list) {
      const m = meta[it.youtube_video_id as string]
      const tries = Number(it.confirm_tries ?? 0) + 1

      // PUBLIC IS THE ONLY YES. Anything else is the video not being on the
      // channel for the people it was scheduled for.
      if (m && m.status === 'public') {
        await sb.from('launch_items').update({
          state: 'published', confirmed_at: stamp(), reason: null,
          confirm_tries: tries, updated_at: stamp(),
        }).eq('id', it.id)
        published++
        continue
      }

      // GONE FROM YOUTUBE ENTIRELY is its own answer, and a different one from
      // "still private": a deleted or rejected video returns nothing at all.
      const missing = !m
      if (tries >= CONFIRM_TRIES) {
        await sb.from('launch_items').update({
          confirm_tries: tries,
          reason: missing
            ? 'The time came and went and YouTube no longer has this video. It may have been removed or rejected. Check the channel.'
            : `The time came and went and YouTube still has this private${m?.publishAt ? ` (it says it will publish at ${m.publishAt})` : ''}. That usually means it is still processing, age restricted, or has a copyright claim.`,
          updated_at: stamp(),
        }).eq('id', it.id)
        late++
      } else {
        await sb.from('launch_items')
          .update({ confirm_tries: tries, updated_at: stamp() }).eq('id', it.id)
      }
    }
  }
  return { published, late }
}

/**
 * A VIDEO HELD FOR PAID PROMOTION IS SCHEDULED ONCE STUDIO HAS IT.
 *
 * YouTube's API can read paid promotion but not set it, so a batch video is
 * uploaded, held private with no time, and waits for Studio (SCOUT's Studio
 * step, or the creator ticking it by hand). This looks at those videos every
 * ten minutes each and, when YouTube reads paid promotion back as Yes, sets the
 * time the creator planned. Nobody has to come back and press anything.
 *
 * A time that has already gone is not quietly moved: the row says so and asks
 * for a new one, the same as any missed slot.
 */
async function heldForDisclosure(sb: Sb, left: Left): Promise<{ scheduled: number; waiting: number; late: number }> {
  const stamp = () => new Date().toISOString()
  const tenAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,youtube_video_id,planned_publish_at,updated_at')
    .eq('state', 'blocked')
    .not('youtube_video_id', 'is', null)
    .like('reason', `${HELD_FOR_PAID_PROMOTION}%`)
    .lt('updated_at', tenAgo)
    .order('updated_at', { ascending: true }).limit(1000)
  // EACH CHECK COSTS FROM THE ONE DAILY YOUTUBE QUOTA EVERY ACCOUNT SHARES.
  // Every ten minutes for every held video, forever, was 144 units a video a
  // day. Often only near the planned time now (lib/launch-release heldCheckDue);
  // SCOUT's Studio step releases a video the moment it saves, so this is the
  // fallback, not the main path.
  const items = (rows ?? []).filter((r: { planned_publish_at: string | null; updated_at?: string | null }) =>
    heldCheckDue(r.planned_publish_at, (r as { updated_at?: string | null }).updated_at ?? null)).slice(0, 25)
  if (items.length === 0) return { scheduled: 0, waiting: 0, late: 0 }

  const batchIds = Array.from(new Set<string>(items.map((i: { batch_id: string }) => String(i.batch_id))))
  const read = await channelsForBatches(sb, batchIds)
  // A wrong login would read every private video as undisclosed: wait instead.
  if (read.failed) return { scheduled: 0, waiting: 0, late: 0 }
  const { data: bs } = await sb.from('launch_batches').select('id,notify_subscribers,timezone').in('id', batchIds)
  const notifyByBatch = new Map<string, boolean>()
  const zoneByBatch = new Map<string, string | null>()
  for (const b of (bs ?? [])) { notifyByBatch.set(b.id, b.notify_subscribers === true); zoneByBatch.set(b.id, b.timezone ?? null) }

  let scheduled = 0, waiting = 0, late = 0
  for (const it of items) {
    if (left() < 20_000) break
    try {
      // The same step saving a Studio run takes at once (lib/launch-release).
      const r = await releaseHeld(sb, it, {
        channelId: read.map.get(it.batch_id) ?? null,
        notify: notifyByBatch.get(it.batch_id) === true,
        zone: zoneByBatch.get(it.batch_id) ?? null,
      })
      if (r.state === 'scheduled' || r.state === 'published') scheduled++
      else if (r.state === 'late') late++
      else waiting++
    } catch (e) {
      // A check that could not run is not a verdict: the row waits and says why.
      console.warn('[launch-drain] held video check failed', { item: it.id, said: e instanceof Error ? e.message : String(e) })
      await sb.from('launch_items').update({ updated_at: stamp() }).eq('id', it.id)
      waiting++
    }
  }
  return { scheduled, waiting, late }
}

/**
 * FIRST COMMENTS FOR LIFTOFF VIDEOS THAT WENT UP WITHOUT ONE: every video
 * uploaded before Liftoff queued them, and any whose queueing failed. Recent
 * videos only, a few a firing, and one per video (lib/first-comment-queue
 * answers "already" for any video that has a row).
 */
async function firstCommentCatchUp(sb: Sb, left: Left): Promise<{ queued: number; failed: number }> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString()
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,youtube_video_id,title,description,planned_publish_at,publish_at,state')
    .not('youtube_video_id', 'is', null).gte('updated_at', since)
    .order('updated_at', { ascending: false }).limit(60)
  const items = (rows ?? []) as Array<{ id: string; user_id: string; youtube_video_id: string; title: string | null; description: string | null; planned_publish_at: string | null; publish_at: string | null; state: string }>
  if (items.length === 0) return { queued: 0, failed: 0 }
  const { data: have, error } = await sb.from('video_first_comments')
    .select('user_id,youtube_video_id').in('youtube_video_id', items.map((i) => i.youtube_video_id))
  if (error) return { queued: 0, failed: 0 }  // no table yet: nothing to catch up into
  const got = new Set((have ?? []).map((h: { user_id: string; youtube_video_id: string }) => `${h.user_id}|${h.youtube_video_id}`))
  let queued = 0, failed = 0
  for (const it of items) {
    if (queued + failed >= 5 || left() < 25_000) break
    if (got.has(`${it.user_id}|${it.youtube_video_id}`)) continue
    const tier = await ownerTier(sb, it.user_id)
    if (!canUsePreview('first_comment', tier)) continue
    const q = await queueFirstComment(sb, {
      userId: it.user_id, tier, youtubeVideoId: it.youtube_video_id,
      title: it.title, description: it.description,
      publishAt: it.publish_at ?? null,
    })
    got.add(`${it.user_id}|${it.youtube_video_id}`)
    if (q.queued) queued++
    else if (q.why !== 'already') failed++
  }
  return { queued, failed }
}

async function settle(sb: Sb): Promise<number> {
  const { data: batches } = await sb.from('launch_batches')
    .select('id,state').in('state', ['draft', 'preparing', 'launching']).limit(50)
  let moved = 0
  for (const b of (batches ?? [])) {
    const { count: total } = await sb.from('launch_items')
      .select('id', { count: 'exact', head: true }).eq('batch_id', b.id)
    if ((total ?? 0) === 0) continue

    // A LAUNCHING BATCH IS DONE WHEN NOTHING IS STILL WAITING TO GO UP. Counted
    // in Postgres rather than from a fetched array, which is how a page length
    // became a total three times in this codebase.
    if (b.state === 'launching') {
      const { count: pending } = await sb.from('launch_items')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', b.id).eq('state', 'prepared').not('planned_publish_at', 'is', null)
      if ((pending ?? 0) === 0) {
        await sb.from('launch_batches')
          .update({ state: 'launched', updated_at: new Date().toISOString() }).eq('id', b.id).eq('state', 'launching')
        moved++
      }
      continue
    }

    const { count: open } = await sb.from('launch_items')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', b.id).in('state', ['draft', 'rendering', 'preparing'])
    const next = (open ?? 0) > 0 ? 'preparing' : 'ready'
    if (next !== b.state) {
      // ONLY FROM THE STATE IT WAS READ IN. A Launch pressed between the read
      // and this write set 'launching', and this used to put it back to
      // 'ready', undoing the launch.
      await sb.from('launch_batches')
        .update({ state: next, updated_at: new Date().toISOString() }).eq('id', b.id).eq('state', b.state)
      moved++
    }
  }
  return moved
}

/**
 * Videos already on YouTube whose batch has a playlist they are not in yet.
 *
 * A PLAYLIST CHOSEN AFTER LAUNCH still reaches the videos. The uploader adds
 * each video as it goes up, which misses every video that went up before the
 * playlist was picked: the first batch to use this launched from a page that
 * did not have the picker yet, and its videos were never in any playlist.
 *
 * Each video is tried once. Added or refused, the answer is written, and a
 * refused one is not retried every minute; the row shows what YouTube said.
 * Before migration 367 the first select fails and this does nothing.
 */
async function playlistCatchUp(sb: Sb): Promise<{ added: number; failed: number }> {
  const { data: batches, error: bErr } = await sb.from('launch_batches')
    .select('id,user_id,playlist_id').not('playlist_id', 'is', null).in('state', ['launching', 'launched'])
  if (bErr || !batches?.length) return { added: 0, failed: 0 }
  const byBatch = new Map<string, { user_id: string; playlist_id: string }>()
  for (const b of batches as Array<{ id: string; user_id: string; playlist_id: string }>) byBatch.set(b.id, b)
  // NOT 'prepared': a prepared row with an id is one the upload step is
  // still finishing, and it adds the playlist itself. Both doing it put the
  // video in the playlist twice.
  const { data: rows, error: iErr } = await sb.from('launch_items')
    .select('id,batch_id,youtube_video_id')
    .in('batch_id', [...byBatch.keys()])
    .in('state', ['scheduled', 'published', 'blocked'])
    .not('youtube_video_id', 'is', null)
    .is('playlist_added_at', null).is('playlist_error', null)
    .order('updated_at', { ascending: true })
    .limit(10)
  if (iErr || !rows?.length) return { added: 0, failed: 0 }
  let added = 0, failed = 0
  const tokens = new Map<string, string | null>()
  // The batch's own channel: the playlist lives there, not on the default.
  // Only the batches these rows belong to, not every launched batch.
  const plRead = await channelsForBatches(sb, [...new Set((rows as Array<{ batch_id: string }>).map((r) => r.batch_id))])
  if (plRead.failed) return { added: 0, failed: 0 }
  const playlistChannel = plRead.map
  for (const it of rows as Array<{ id: string; batch_id: string; youtube_video_id: string }>) {
    const b = byBatch.get(it.batch_id)
    if (!b) continue
    const bch = playlistChannel.get(it.batch_id) ?? null
    const tk = `${b.user_id}|${bch ?? ''}`
    if (!tokens.has(tk)) tokens.set(tk, await getChannelOAuthToken(sb, b.user_id, bch).catch(() => null))
    const token = tokens.get(tk)
    if (!token) {
      // SAID, not skipped: a skipped row came back every firing and took a
      // slot another creator's video needed.
      await sb.from('launch_items').update({ playlist_error: 'Your YouTube channel is not connected for publishing, so it could not be added to the playlist.' }).eq('id', it.id)
      failed++
      continue
    }
    try {
      await new YouTubeOAuthService(token).addVideoToPlaylist(b.playlist_id, it.youtube_video_id)
      await sb.from('launch_items').update({ playlist_added_at: new Date().toISOString(), playlist_error: null }).eq('id', it.id)
      added++
    } catch (e) {
      const said = (e instanceof Error && e.message ? e.message : String(e)).slice(0, 200)
      // Out of the shared daily allowance: try again after the reset, and
      // stop asking for the rest of this run.
      if (/quotaExceeded|dailyLimitExceeded/i.test(said)) break
      await sb.from('launch_items').update({ playlist_error: said }).eq('id', it.id)
      failed++
    }
  }
  return { added, failed }
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient() as Sb
  const started = Date.now()
  // Seconds of this firing left, with room kept back for the final writes.
  const left: Left = () => maxDuration * 1000 - 15_000 - (Date.now() - started)

  // ── PREPARING AND PUBLISHING TAKE TURNS ────────────────────────────────
  //
  // They used to share every firing: a render (minutes), then a thumbnail
  // (minutes), then an upload (minutes), against a 300 second limit. The
  // function was killed part way far more often than it finished, so a
  // thumbnail that had been generated was never written, and uploads for
  // every creator waited behind somebody else's image. Now even minutes
  // prepare and odd minutes publish, each with the whole limit, and every step
  // checks the time it has left before it starts rather than after.
  // `?pass=prepare` or `?pass=publish` forces one, for a manual run.
  const forced = new URL(request.url).searchParams.get('pass')
  const pass = forced === 'prepare' || forced === 'publish'
    ? forced
    : (new Date().getUTCMinutes() % 2 === 0 ? 'prepare' : 'publish')

  if (pass === 'prepare') {
    // SIDE BY SIDE. Renders ran first and took most of the firing, so no
    // thumbnail started while any video was still waiting for its CTA. They
    // work on different rows (draft against preparing), so neither can touch
    // the other's.
    const [rendered, thumbed] = await Promise.all([renders(sb, left), thumbs(sb, left)])
    const settled = await settle(sb)
    return NextResponse.json({ ok: true, pass, rendered, thumbed, settled })
  }
  const published = await publishes(sb, left)
  // AFTER the publishing, and cheap: one YouTube call covers fifty ids.
  const confirmed = left() > 30_000 ? await confirms(sb) : null
  // Held for paid promotion, and Studio has it now: schedule at the planned time.
  const disclosed = left() > 30_000 ? await heldForDisclosure(sb, left) : null
  // Videos on YouTube that never reached the Amazon side. Cheap when empty.
  const repaired = left() > 20_000 ? await repairs(sb) : null
  const playlisted = left() > 20_000 ? await playlistCatchUp(sb) : null
  const firstComments = left() > 30_000 ? await firstCommentCatchUp(sb, left) : null
  const settled = await settle(sb)
  return NextResponse.json({ ok: true, pass, published, confirmed, disclosed, repaired, playlisted, firstComments, settled })
}


/**
 * Send a video to YouTube in pieces, carrying on from wherever its upload
 * session got to. Returns done with the video's id, or how many bytes YouTube
 * has so far when this run is running out of time. The session address is
 * saved on the row the moment it is opened, so a run that dies mid-piece
 * loses at most that piece.
 */
async function sendInPieces(
  sb: Sb, yt: YouTubeOAuthService, itemId: string, src: string, total: number, saved: string | null,
  openOpts: Parameters<YouTubeOAuthService['startResumableUpload']>[1], left: Left,
): Promise<{ done: true; id: string; channelId: string | null } | { done: false; sent: number }> {
  let url = saved
  let next = 0
  if (url) {
    const st = await YouTubeOAuthService.resumableStatus(url, total)
    if ('done' in st) {
      return st
    }
    if ('gone' in st) url = null
    else next = st.next
  }
  if (!url) {
    url = await yt.startResumableUpload(total, openOpts)
    const { error } = await sb.from('launch_items').update({ yt_upload_url: url }).eq('id', itemId)
    if (error) console.error('[launch-drain] could not keep the upload session', { item: itemId, said: error.message })
    next = 0
  }
  while (next < total) {
    if (left() < 75_000) return { done: false, sent: next }
    const end = Math.min(total, next + PIECE) - 1
    const piece = await fetchWithTimeout(src, { headers: { Range: `bytes=${next}-${end}` }, timeoutMs: 45_000 })
    if (piece.status !== 206 && !(piece.status === 200 && next === 0 && end === total - 1)) {
      throw new Error(`the video file could not be read in pieces (${piece.status})`)
    }
    const bytes = new Uint8Array(await piece.arrayBuffer())
    const r = await YouTubeOAuthService.putChunk(url, bytes, next, total, Math.max(20_000, left() - 45_000))
    if ('done' in r) {
      return r
    }
    next = r.next
  }
  const st = await YouTubeOAuthService.resumableStatus(url, total)
  if ('done' in st) {
    return st
  }
  return { done: false, sent: 'next' in st ? st.next : next }
}
