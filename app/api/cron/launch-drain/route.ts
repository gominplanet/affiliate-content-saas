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
import { renderCta } from '@/lib/youtube-ingest'
import { normalizeTier } from '@/lib/tier'
import { ctaStickerAllowed, type CtaPreset } from '@/lib/launch-batch'
import { validateThumbnailPreset, presetToRequestFields, type ThumbnailPreset } from '@/lib/thumbnail-preset'
import { postToSelf } from '@/lib/self-url'
import { getChannelOAuthToken } from '@/lib/youtube-channels'
import { YouTubeOAuthService } from '@/services/youtube'
import { coveragePriority } from '@/lib/storefront-coverage'
import { marketByDomain } from '@/lib/markets'
import { fetchWithTimeout } from '@/lib/fetch-timeout'

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
const IMAGES = 1
/** Tries before a video stops asking and says why. */
const TRIES = 3
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
/** Videos pushed to YouTube per firing. ONE: this downloads a whole file and
 *  uploads it again, which is the longest single operation in the product. */
const PUBLISHES = 1
/** The most a video may be before this refuses to push it, matching the
 *  interactive uploader so a batch cannot smuggle through something a single
 *  upload would have rejected. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

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
async function renders(sb: Sb): Promise<{ done: number; skipped: number; failed: number }> {
  const { data: rows } = await sb.from('launch_items')
    .select('id,batch_id,user_id,source_url,render_tries,reason')
    .eq('state', 'draft').not('source_url', 'is', null)
    .order('created_at', { ascending: true }).limit(RENDERS * 4)
  const items = rows ?? []
  if (items.length === 0) return { done: 0, skipped: 0, failed: 0 }

  let done = 0, skipped = 0, failed = 0
  let budget = RENDERS
  const now = () => new Date().toISOString()

  for (const it of items) {
    if (budget <= 0) break
    const { data: batch } = await sb.from('launch_batches')
      .select('cta,cta_chosen').eq('id', it.batch_id).maybeSingle()
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
    await sb.from('launch_items')
      .update({ state: 'rendering', render_tries: tries + 1, updated_at: now() }).eq('id', it.id)
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
      const out = await renderCta(it.source_url as string, {
        text: '', subtext: '', style: cta.style, startSec, endSec,
        stickerUrl: cta.stickerUrl, widthPct: cta.widthPct, xPct: cta.xPct, yPct: cta.yPct,
      }, it.user_id as string)
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
      await sb.from('launch_items').update({
        rendered_url: out.url, clean_url: it.source_url,
        state: 'preparing', reason: null, updated_at: now(),
      }).eq('id', it.id)
      done++
    } catch (e) {
      // BACK TO DRAFT so the next firing picks it up again, with the reason on
      // the row so the board is not silent while it waits.
      await sb.from('launch_items').update({
        state: 'draft',
        reason: (e instanceof Error ? e.message : 'the render did not finish').slice(0, 200),
        updated_at: now(),
      }).eq('id', it.id)
      failed++
    }
  }
  return { done, skipped, failed }
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
async function thumbs(sb: Sb): Promise<{ done: number; blocked: number; plain: number; failed: number }> {
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,asin,title,thumbnail_url,thumbnail_clean_url,thumb_tries')
    .eq('state', 'preparing')
    .order('created_at', { ascending: true }).limit(8)
  const items = rows ?? []
  if (items.length === 0) return { done: 0, blocked: 0, plain: 0, failed: 0 }

  let done = 0, blocked = 0, plain = 0, failed = 0
  let budget = IMAGES
  const now = () => new Date().toISOString()

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

  for (const it of items) {
    if (budget <= 0) break
    const asin = (it.asin || '').trim()
    const title = (it.title || '').trim()
    // NOT BLOCKED, WAITING. The creator sets the product in their own time and
    // this is the one step that genuinely needs them.
    if (!asin || !title) continue

    // Already has both images: nothing to do but say so.
    if (it.thumbnail_url && it.thumbnail_clean_url) {
      await sb.from('launch_items')
        .update({ state: 'prepared', reason: null, updated_at: now() }).eq('id', it.id)
      done++
      continue
    }

    const tries = Number(it.thumb_tries ?? 0)
    if (tries >= THUMB_TRIES) {
      // PREPARED ANYWAY, because a missing thumbnail does not stop a listing:
      // YouTube takes a frame from the video. Said on the row so the creator
      // knows what their listing will look like rather than finding out later.
      await sb.from('launch_items').update({
        state: 'prepared',
        reason: `No thumbnail could be built after ${tries} tries, so YouTube will use a frame from the video.`,
        updated_at: now(),
      }).eq('id', it.id)
      blocked++
      continue
    }

    await sb.from('launch_items')
      .update({ thumb_tries: tries + 1, updated_at: now() }).eq('id', it.id)

    const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', it.user_id).maybeSingle()
    const tier = normalizeTier(integ?.tier)
    const patch: Record<string, unknown> = { updated_at: now() }
    const preset = await loadPreset(it.batch_id)
    let usedPlain = false
    // WHY it fell back, kept so the row can say it. "Could not be applied" is
    // true of a timeout, a missing face and a spend cap alike, and none of
    // those has the same answer.
    let plainWhy = ''
    try {
      if (!it.thumbnail_url && budget > 0) {
        budget--
        // THE SAME GENERATOR VIDEO LAUNCHPAD USES, with the batch's chosen
        // look. This route is what gives a thumbnail a hook style, a face, a
        // pose, a badge and a look to match, and calling anything else here is
        // what left a batch thumbnail with no options at all.
        const branded = await styledThumbnail(it.user_id, title, asin, preset)
        if (branded.url) patch.thumbnail_url = branded.url
        else {
          plainWhy = branded.why
          // THE FALLBACK IS RECORDED, NOT HIDDEN. A plain thumbnail is better
          // than none, but it is NOT the look they picked, and until this was
          // written down the two outcomes were the same row on screen.
          const basic = await buildProductThumbnail(sb, { userId: it.user_id, tier, title, asin, withText: true })
          if (basic) { patch.thumbnail_url = basic; usedPlain = true }
        }
      }
      if (!it.thumbnail_clean_url && budget > 0) {
        budget--
        // The wordless copy for non-English storefronts. The styled route bakes
        // a headline in by design, so the clean variant stays with the builder
        // that can be told to write nothing at all.
        const clean = await buildProductThumbnail(sb, {
          userId: it.user_id, tier, title, asin, withText: false,
          faceId: preset.face.kind === 'face' ? preset.face.faceId : null,
          noHuman: preset.face.kind === 'none',
        })
        if (clean) patch.thumbnail_clean_url = clean
      }
    } catch { /* the try is already counted; the next firing has another go */ }

    if (patch.thumbnail_url) {
      patch.thumbnail_source = usedPlain ? 'plain' : 'styled'
      if (usedPlain) plain++
    }
    const haveBranded = patch.thumbnail_url || it.thumbnail_url
    const haveClean = patch.thumbnail_clean_url || it.thumbnail_clean_url
    if (haveBranded && haveClean) {
      patch.state = 'prepared'
      // The fallback keeps its sentence. Clearing `reason` on the way to
      // 'prepared' would erase the one place the creator could read that this
      // thumbnail is not the look they chose.
      patch.reason = usedPlain
        ? `Your chosen look could not be applied, so this is the plain product thumbnail. ${plainWhy}`.trim()
        : null
      done++
    }
    // ── THE WRITE IS CHECKED ─────────────────────────────────────────────
    //
    // This used to be fire and forget, and that is how a video sat on
    // "Building the thumbnail" for forty minutes with nothing anywhere saying
    // why. A column this patch names that the database does not have (a
    // migration half applied, a deploy ahead of the schema) fails the whole
    // update, so the state never moves, the try count climbs, and the screen
    // reports the same sentence it reported at the start.
    //
    // Now the failure lands on the row in words, through a SECOND write that
    // touches only columns the table has had since it was created, so the
    // report itself cannot fail for the same reason the first one did.
    const { error: wrote } = await sb.from('launch_items').update(patch).eq('id', it.id)
    if (wrote) {
      failed++
      await sb.from('launch_items').update({
        reason: `The thumbnail was built but could not be saved: ${String(wrote.message || wrote).slice(0, 140)}`,
        updated_at: now(),
      }).eq('id', it.id)
    }
  }
  return { done, blocked, plain, failed }
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
): Promise<{ url: string | null; why: string }> {
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
        ...presetToRequestFields(preset),
      },
    })
    if (!res.ok) {
      // THE ROUTE'S OWN WORDS. It refuses for real reasons a creator can act
      // on (no saved face, a spend cap, an ASIN it cannot fetch), and throwing
      // all of them away left one sentence that fitted every cause equally
      // badly and pointed at none of them.
      const body = await res.json().catch(() => ({})) as { error?: string }
      const said = String(body.error || '').trim().slice(0, 160)
      return { url: null, why: said || `the thumbnail service answered ${res.status} after ${secs()}s` }
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
async function publishes(sb: Sb): Promise<{ scheduled: number; failed: number }> {
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,position,title,description,rendered_url,clean_url,thumbnail_url,thumbnail_clean_url,asin,duration_seconds,planned_publish_at,publish_tries,reason')
    .eq('state', 'prepared').not('planned_publish_at', 'is', null)
    .order('planned_publish_at', { ascending: true }).limit(PUBLISHES * 4)
  const items = rows ?? []
  if (items.length === 0) return { scheduled: 0, failed: 0 }

  let scheduled = 0, failed = 0
  let budget = PUBLISHES
  const stamp = () => new Date().toISOString()

  for (const it of items) {
    if (budget <= 0) break
    const src = (it.rendered_url || '').trim()
    const title = (it.title || '').trim()
    if (!/^https:\/\//i.test(src) || !title) continue

    const tries = Number(it.publish_tries ?? 0)
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
      const generic = /^YouTube would not take this video/.test(said)
      await sb.from('launch_items').update({
        state: 'blocked',
        reason: said && !generic
          ? `YouTube refused this ${tries} times. The last thing it said: ${said}`.slice(0, 300)
          : `YouTube would not take this video after ${tries} tries, and gave no reason we could read. Check the channel is still connected under Settings.`,
        updated_at: stamp(),
      }).eq('id', it.id)
      failed++
      continue
    }
    await sb.from('launch_items')
      .update({ publish_tries: tries + 1, updated_at: stamp() }).eq('id', it.id)
    budget--

    try {
      const token = await getChannelOAuthToken(sb, it.user_id as string, null)
      if (!token) throw new Error('your YouTube channel is not connected for publishing')

      // Refuse on the header before pulling the body into memory, the same way
      // the interactive uploader does. Downloading half a gigabyte to discover
      // it is half a gigabyte is the check becoming the problem.
      const res = await fetchWithTimeout(src, { timeoutMs: 240_000 })
      if (!res.ok) throw new Error(`the video file could not be read (${res.status})`)
      const declared = Number(res.headers.get('content-length') || 0)
      if (declared && declared > MAX_UPLOAD_BYTES) throw new Error('this video is too large for YouTube')
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('this video is too large for YouTube')

      const yt = new YouTubeOAuthService(token)

      // ── NOW, OR AT ITS MOMENT ────────────────────────────────────────────
      //
      // A planned time that has already gone means the creator asked for this
      // one to go out now: they picked today and pressed Launch. YouTube
      // refuses a publishAt in the past, so "now" cannot be said that way at
      // all. It is said by uploading public instead, which is the same thing
      // in the form the API accepts.
      //
      // Everything else uploads PRIVATE first. Uploading public and scheduling
      // afterwards would put the video on the channel for however long the
      // second call takes.
      const goNow = new Date(String(it.planned_publish_at)).getTime() <= Date.now()

      const { id: videoId, channelId } = await yt.uploadShort(bytes, {
        title: title.slice(0, 100),
        description: (it.description || '').slice(0, 4900),
        privacyStatus: goNow ? 'public' : 'private',
      })

      if (!goNow) {
        // THE SCHEDULE ITSELF, and its result is what decides whether this row
        // may call itself scheduled.
        await yt.updateVideoStatus(videoId, {
          publishAt: String(it.planned_publish_at),
          notifySubscribers: true,
        })
      }

      await sb.from('launch_items').update({
        // PUBLISHED, NOT SCHEDULED, when it went out now. They are different
        // facts and the row has always kept them apart; collapsing them here
        // would have the board promising a future publication for a video that
        // is already on the channel.
        state: goNow ? 'published' : 'scheduled',
        youtube_video_id: videoId,
        // THE MOMENT IT ACTUALLY WENT, not the slot that had gone by. A row
        // saying it published at nine this morning, written at two in the
        // afternoon, is the plan reported as the result.
        publish_at: goNow ? stamp() : it.planned_publish_at,
        reason: null,
        updated_at: stamp(),
      }).eq('id', it.id)

      await handOverToAmazon(sb, it, videoId, channelId)
      scheduled++
    } catch (e) {
      // LEFT PREPARED so the next firing tries again, with the reason on the
      // row rather than in a log nobody reads.
      await sb.from('launch_items').update({
        reason: (e instanceof Error ? e.message : 'YouTube would not take this video').slice(0, 200),
        updated_at: stamp(),
      }).eq('id', it.id)
      failed++
    }
  }
  return { scheduled, failed }
}

/**
 * Hand a freshly scheduled video to the Amazon side.
 *
 * NO SECOND PIPELINE. A video on YouTube is an ordinary video, so it gets a
 * youtube_videos row and a coverage cell per country the batch picked, and the
 * existing grid does the rest: the product check, the translation, the dub, and
 * the queue SCOUT uploads from. Everything built and tested this week.
 *
 * Best-effort and never fails the publish: the video IS scheduled by now, and
 * throwing here would send it round the retry loop and upload it twice.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handOverToAmazon(sb: Sb, it: any, videoId: string, channelId: string | null): Promise<void> {
  try {
    const { data: batch } = await sb.from('launch_batches')
      .select('markets').eq('id', it.batch_id).maybeSingle()
    const markets: string[] = (batch?.markets ?? []).filter((d: string) => !!marketByDomain(d))
    if (markets.length === 0) return

    const { data: video } = await sb.from('youtube_videos').upsert({
      user_id: it.user_id,
      youtube_video_id: videoId,
      title: it.title,
      channel_id: channelId || 'unknown',
      published_at: it.planned_publish_at,
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
    }, { onConflict: 'youtube_video_id' }).select('id').single()
    if (!video?.id) return

    await sb.from('launch_items').update({ video_id: video.id }).eq('id', it.id)

    const priority = coveragePriority({ publishedAt: it.planned_publish_at })
    await sb.from('storefront_coverage').upsert(
      markets.map((domain) => ({
        user_id: it.user_id, video_id: video.id, domain,
        state: 'unknown', asin: it.asin ?? null, priority,
      })),
      { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true },
    )
  } catch { /* the video is scheduled; the grid can be seeded on a later pass */ }
}

/** Move a batch's own state to match its videos, so the page does not have to
 *  work it out and cannot disagree. */
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
          .update({ state: 'launched', updated_at: new Date().toISOString() }).eq('id', b.id)
        moved++
      }
      continue
    }

    const { count: open } = await sb.from('launch_items')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', b.id).in('state', ['draft', 'rendering', 'preparing'])
    const next = (open ?? 0) > 0 ? 'preparing' : 'ready'
    if (next !== b.state) {
      await sb.from('launch_batches')
        .update({ state: next, updated_at: new Date().toISOString() }).eq('id', b.id)
      moved++
    }
  }
  return moved
}

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient() as Sb
  const rendered = await renders(sb)
  const thumbed = await thumbs(sb)
  // LAST, because it is the longest single operation here and putting it ahead
  // of the cheap steps would let one slow upload starve every other batch.
  const published = await publishes(sb)
  const settled = await settle(sb)
  return NextResponse.json({ ok: true, rendered, thumbed, published, settled })
}
