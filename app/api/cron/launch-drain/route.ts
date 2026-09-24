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
import { generateProductTitleOptions } from '@/lib/title-options'
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
async function thumbs(sb: Sb): Promise<{ done: number; blocked: number; plain: number; failed: number; metaMissing: number }> {
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,asin,title,title_source,description,tags,thumbnail_url,thumbnail_clean_url,thumb_tries')
    .eq('state', 'preparing')
    .order('created_at', { ascending: true }).limit(8)
  const items = rows ?? []
  if (items.length === 0) return { done: 0, blocked: 0, plain: 0, failed: 0, metaMissing: 0 }

  let done = 0, blocked = 0, plain = 0, failed = 0, metaMissing = 0
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
    let title = (it.title || '').trim()
    // NOT BLOCKED, WAITING. The creator sets the product in their own time and
    // this is the one step that genuinely needs them.
    if (!asin || !title) continue

    // ── THE TITLE MVP WRITES, NOT THE NAME OF THE FILE ───────────────────
    //
    // Adding videos to a batch seeded each title from the uploaded file name,
    // and nothing ever replaced it. A creator uploaded STEAM BRUSH WORKS?.mp4
    // and that became the video's title, the subject handed to the thumbnail
    // generator, the subject handed to the description writer, and the title
    // on YouTube. On the same channel, videos that went through Launchpad read
    // "Finally, a Camping Table That Actually Fits in the Boot". The batch had
    // a Write it for me button and it had to be pressed once per video; a
    // creator who never pressed it got ten file names.
    //
    // BEFORE ANYTHING ELSE IN THIS LOOP, because the thumbnail and the
    // description are both written FROM the title, so a file name fixed after
    // them would leave an image and a description about a file name.
    //
    // ONLY WHAT NOBODY CHOSE. 'creator' is never touched and 'mvp' is never
    // rewritten, so this runs at most once per video and a typed title is
    // safe. Null is treated as a file name because every row that predates the
    // column got its title from one.
    const titleSource = String(it.title_source || 'filename')
    if (titleSource !== 'creator' && titleSource !== 'mvp') {
      const written = await productTitle(it.user_id, title, asin)
      if (written) {
        title = written
        await sb.from('launch_items')
          .update({ title, title_source: 'mvp', updated_at: now() }).eq('id', it.id)
      }
      // A FAILURE HERE IS NOT A BLOCK. The file name is a poor title and a
      // missing video is worse, so it carries on and the row keeps saying
      // where the title came from.
    }

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

    // ── THE DESCRIPTION, WHICH IS WHERE THE AFFILIATE LINK LIVES ─────────
    //
    // Without it a batch video went to YouTube with an EMPTY description while
    // the CTA burned into its own frame said "link in the description". The
    // video pointed at nothing and earned nothing, which made the YouTube half
    // of the whole feature decorative.
    //
    // The same writer Video Launchpad uses, so a batch description and a
    // single-video one come from one place. Best effort: a video with no
    // description still publishes, because a video on the channel beats a
    // video held back, and the row says which it got.
    if (!String(it.description || '').trim()) {
      const meta = await videoMetadata(it.user_id, title, asin)
      if (meta?.description) {
        patch.description = meta.description
        if (meta.tags?.length) patch.tags = meta.tags.join(', ')
        // THE YOUTUBE TITLE CO-PILOT WOULD WRITE. The title above is the 2 to
        // 3 word thumbnail hook ("CHIA WORTH IT?"), right on the image and
        // wrong as a YouTube title, and it went to YouTube as one because
        // nothing replaced it. The same call that writes the description
        // writes a proper title; it used to be thrown away. Never over a
        // title the creator typed.
        if (meta.title && String(it.title_source || 'filename') !== 'creator') {
          patch.title = meta.title.slice(0, 100)
          patch.title_source = 'mvp'
        }
      } else {
        metaMissing++
      }
    }

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
/** A missed slot in plain words, in the creator's own zone. Their 17:00 read
 *  back as "21:00 UTC" would look like a second mistake on top of the first. */
function missedWhen(iso: string, timezone: string | null): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'the time you picked'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d) + ' UTC'
  }
}

async function publishes(sb: Sb): Promise<{ scheduled: number; failed: number }> {
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,batch_id,position,title,description,tags,rendered_url,clean_url,thumbnail_url,thumbnail_clean_url,asin,duration_seconds,planned_publish_at,publish_tries,reason,youtube_video_id')
    .eq('state', 'prepared').not('planned_publish_at', 'is', null)
    .order('planned_publish_at', { ascending: true }).limit(PUBLISHES * 4)
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
  {
    const batchIds = [...new Set(items.map((i: { batch_id: string }) => i.batch_id))]
    const { data: pb, error: pbErr } = await sb.from('launch_batches')
      .select('id,playlist_id').in('id', batchIds)
    if (!pbErr) {
      for (const b of (pb ?? []) as Array<{ id: string; playlist_id: string | null }>) {
        if (b.playlist_id) playlistByBatch.set(b.id, b.playlist_id)
      }
      const { data: pa, error: paErr } = await sb.from('launch_items')
        .select('id').in('id', items.map((i: { id: string }) => i.id)).not('playlist_added_at', 'is', null)
      if (paErr) playlistByBatch.clear()
      else for (const r of (pa ?? []) as Array<{ id: string }>) inPlaylist.add(r.id)
    }
  }

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
      // AN ATTEMPT THAT NEVER REPORTED BACK IS ITS OWN ANSWER, and a different
      // one from "YouTube said no". It means the firing was cut off before the
      // catch could run, which is a time problem and not a YouTube problem, and
      // quoting the note back as "the last thing it said" would hide that.
      const inflight = /^Attempt \d+ of \d+ is running now\.$/.test(said)
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
    await sb.from('launch_items').update({
      publish_tries: tries + 1,
      reason: `Attempt ${tries + 1} of ${TRIES} is running now.`,
      updated_at: stamp(),
    }).eq('id', it.id)
    budget--

    try {
      const token = await getChannelOAuthToken(sb, it.user_id as string, null)
      if (!token) throw new Error('your YouTube channel is not connected for publishing')

      const yt = new YouTubeOAuthService(token)

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
      const missed = due && !goNow

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
      let videoId = String(it.youtube_video_id || '').trim()
      let channelId: string | null = null
      if (!videoId) {
        // Refuse on the header before pulling the body into memory, the same
        // way the interactive uploader does. Downloading half a gigabyte to
        // discover it is half a gigabyte is the check becoming the problem.
        const res = await fetchWithTimeout(src, { timeoutMs: 240_000 })
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
          privacyStatus: goNow ? 'public' : 'private',
          // The batch's toggle, sent explicitly: left out, YouTube notifies.
          notifySubscribers: notifyByBatch.get(it.batch_id) === true,
        })
        videoId = up.id
        channelId = up.channelId
        // IMMEDIATELY, AND ON ITS OWN. Not bundled into the update at the end
        // of this block: everything between here and there is a way for this
        // fact to be lost, and losing it is what put three copies on a channel.
        await sb.from('launch_items')
          .update({ youtube_video_id: videoId, updated_at: stamp() }).eq('id', it.id)
      }

      // The batch's zone, only when it is needed for the kept-private note.
      let missedZone: string | null = null
      if (missed) {
        const { data: zb } = await sb.from('launch_batches').select('timezone').eq('id', it.batch_id).maybeSingle()
        missedZone = zb?.timezone ?? null
      }

      if (!goNow && !missed) {
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
      const thumbSrc = String(it.thumbnail_url || '').trim()
      const thumb: { at: string | null; error: string | null } = { at: null, error: null }
      if (/^https:\/\//i.test(thumbSrc)) {
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
          await yt.addVideoToPlaylist(playlist, videoId)
          added = stamp()
        } catch (pe) {
          plError = (pe instanceof Error && pe.message ? pe.message : String(pe)).slice(0, 200)
          console.warn('[launch-drain] playlist refused', { item: it.id, said: plError })
        }
        await sb.from('launch_items').update({ playlist_added_at: added, playlist_error: plError }).eq('id', it.id)
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
        state: goNow ? 'published' : missed ? 'blocked' : 'scheduled',
        youtube_video_id: videoId,
        // THE MOMENT IT ACTUALLY WENT, not the slot that had gone by. A row
        // saying it published at nine this morning, written at two in the
        // afternoon, is the plan reported as the result.
        publish_at: goNow ? stamp() : missed ? null : it.planned_publish_at,
        reason: missed
          ? `Kept private. Its time, ${missedWhen(String(it.planned_publish_at), missedZone)}, passed while it was still waiting to upload, so it was not made public. Set a publish time for it in YouTube Studio.`
          : null,
        updated_at: stamp(),
      }).eq('id', it.id)

      const handed = await handOverToAmazon(sb, it, videoId, channelId, goNow ? stamp() : it.planned_publish_at)
      // Not overwriting the kept-private note with a hand-over note: the
      // private one is the thing the creator has to act on.
      if (missed && !handed.ok) { scheduled++; continue }
      await noteHandOver(sb, it.id, handed)
      scheduled++
    } catch (e) {
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
type HandOver = { ok: true } | { ok: false; skipped: 'no-markets' } | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handOverToAmazon(sb: Sb, it: any, videoId: string, channelId: string | null, publishedAt?: string | null): Promise<HandOver> {
  try {
    const { data: batch } = await sb.from('launch_batches')
      .select('markets').eq('id', it.batch_id).maybeSingle()
    const markets: string[] = (batch?.markets ?? []).filter((d: string) => !!marketByDomain(d))
    if (markets.length === 0) return { ok: false, skipped: 'no-markets' }

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

    const { error: linkErr } = await sb.from('launch_items')
      .update({ video_id: video.id, reason: null }).eq('id', it.id)
    if (linkErr) return { ok: false, error: linkErr.message }

    const priority = coveragePriority({ publishedAt: publishedAt || it.publish_at || it.planned_publish_at })
    const { error: gridErr } = await sb.from('storefront_coverage').upsert(
      markets.map((domain) => ({
        user_id: it.user_id, video_id: video.id, domain,
        state: 'unknown', asin: it.asin ?? null, priority,
      })),
      { onConflict: 'user_id,video_id,domain', ignoreDuplicates: true },
    )
    if (gridErr) return { ok: false, error: gridErr.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Say on the row that the hand-over did not land, in its own words. The video
 *  is on YouTube and the row's state says so; this is a note on a working row,
 *  and it names the next attempt so it does not read as the end. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function noteHandOver(sb: Sb, id: string, r: HandOver): Promise<void> {
  if (r.ok || !('error' in r)) return
  await sb.from('launch_items').update({
    reason: `On YouTube, but it could not be passed to the Amazon side yet: ${r.error}. MVP tries again every minute.`.slice(0, 300),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
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
    .select('id,user_id,batch_id,title,description,asin,thumbnail_url,thumbnail_clean_url,duration_seconds,clean_url,planned_publish_at,publish_at,youtube_video_id')
    .in('state', ['scheduled', 'published'])
    .not('youtube_video_id', 'is', null)
    .is('video_id', null)
    .order('updated_at', { ascending: true })
    .limit(REPAIRS * 5)
  const candidates = rows ?? []
  if (candidates.length === 0) return { linked: 0, failed: 0 }

  // A batch that picked no countries has nothing to hand over, ever. Filtered
  // here so those rows cannot take every slot in the limit, firing after
  // firing, and starve the ones that do.
  const batchIds = [...new Set(candidates.map((c: { batch_id: string }) => c.batch_id))]
  const { data: batches } = await sb.from('launch_batches').select('id,markets').in('id', batchIds)
  const withMarkets = new Set(
    ((batches ?? []) as Array<{ id: string; markets: string[] | null }>)
      .filter((b) => (b.markets ?? []).some((d) => !!marketByDomain(d)))
      .map((b) => b.id),
  )

  let linked = 0, failed = 0
  for (const it of candidates.filter((c: { batch_id: string }) => withMarkets.has(c.batch_id)).slice(0, REPAIRS)) {
    // The channel id is not stored on the row, so the title lookup falls back
    // to empty here; the channel sync fills it in later.
    const r = await handOverToAmazon(sb, it, String(it.youtube_video_id), null, it.publish_at)
    if (r.ok) linked++
    else { failed++; await noteHandOver(sb, it.id, r) }
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
  const { data: rows } = await sb.from('launch_items')
    .select('id,user_id,title,youtube_video_id,publish_at,confirm_tries')
    .eq('state', 'scheduled')
    .not('youtube_video_id', 'is', null)
    .lte('publish_at', cutoff)
    .order('publish_at', { ascending: true }).limit(CONFIRMS)
  const items = rows ?? []
  if (items.length === 0) return { published: 0, late: 0 }

  // GROUPED BY CREATOR, because the token is per account and one call takes
  // fifty ids. Checking forty videos costs at most a handful of requests.
  const byUser = new Map<string, typeof items>()
  for (const it of items) {
    const list = byUser.get(it.user_id) ?? []
    list.push(it)
    byUser.set(it.user_id, list)
  }

  let published = 0, late = 0
  const stamp = () => new Date().toISOString()

  for (const [userId, list] of byUser) {
    let meta: Record<string, { status: string; publishAt: string | null }> = {}
    try {
      const token = await getChannelOAuthToken(sb, userId, null)
      if (!token) continue
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
  const { data: rows, error: iErr } = await sb.from('launch_items')
    .select('id,batch_id,youtube_video_id')
    .in('batch_id', [...byBatch.keys()])
    .not('youtube_video_id', 'is', null)
    .is('playlist_added_at', null).is('playlist_error', null)
    .limit(10)
  if (iErr || !rows?.length) return { added: 0, failed: 0 }
  let added = 0, failed = 0
  const tokens = new Map<string, string | null>()
  for (const it of rows as Array<{ id: string; batch_id: string; youtube_video_id: string }>) {
    const b = byBatch.get(it.batch_id)
    if (!b) continue
    if (!tokens.has(b.user_id)) tokens.set(b.user_id, await getChannelOAuthToken(sb, b.user_id, null).catch(() => null))
    const token = tokens.get(b.user_id)
    if (!token) continue
    try {
      await new YouTubeOAuthService(token).addVideoToPlaylist(b.playlist_id, it.youtube_video_id)
      await sb.from('launch_items').update({ playlist_added_at: new Date().toISOString(), playlist_error: null }).eq('id', it.id)
      added++
    } catch (e) {
      const said = (e instanceof Error && e.message ? e.message : String(e)).slice(0, 200)
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
  const rendered = await renders(sb)
  const thumbed = await thumbs(sb)
  // LAST, because it is the longest single operation here and putting it ahead
  // of the cheap steps would let one slow upload starve every other batch.
  const published = await publishes(sb)
  // AFTER the publishing, and cheap: one YouTube call covers fifty ids, so this
  // never competes with the upload for the firing's time.
  const confirmed = await confirms(sb)
  // Videos on YouTube that never reached the Amazon side. Cheap when empty.
  const repaired = await repairs(sb)
  const playlisted = await playlistCatchUp(sb)
  const settled = await settle(sb)
  return NextResponse.json({ ok: true, rendered, thumbed, published, confirmed, repaired, playlisted, settled })
}
