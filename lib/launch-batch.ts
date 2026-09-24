// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What a launch batch is, and what "ready" means for one.
//
// TEN VIDEOS, ONE EVENING. Video Launchpad is one video with a creator watching
// it, which is right for one video and wrong for ten: the slow parts all run on
// our servers and need nobody present, so making somebody sit through them ten
// times is the entire friction.
//
// The rules live here rather than in the page, because the page and the
// background worker must agree about what is done. A screen that decides for
// itself which steps are complete is a screen that can say "ready to launch"
// about a batch the worker will refuse.
//
// ONE THING CANNOT BE UNATTENDED. SCOUT drives the creator's own logged-in
// Amazon Creator Hub in their own browser and there is no server-side session
// for amazon.de. Everything else (the CTA burn, the thumbnails, the product
// research, the translation, every dub, and YouTube itself) runs without them.
// So the promise is: set it up, press Launch, leave the tab open, walk away.

import { normalizeSlots, cadenceLabel, hasOwnSchedule } from '@/lib/launch-schedule'
import { presetSummary, type ThumbnailPreset } from '@/lib/thumbnail-preset'

/** The most videos in one batch. Ten is the number Seb asked for, and it is
 *  also about the point where a single Launch press stops being reviewable. */
export const MAX_ITEMS = 10

/** Where a whole batch is up to. */
export type BatchState = 'draft' | 'preparing' | 'ready' | 'launching' | 'launched'

/** Where one video is up to.
 *
 *  `prepared` is the honest end of the unattended work: the CTA is burned in,
 *  the thumbnail exists, the product is known. It is NOT "on YouTube", and the
 *  two were deliberately kept apart after a session spent finding screens that
 *  reported the plan rather than the result. */
export type ItemState =
  | 'draft'      // added, nothing done to it yet
  | 'rendering'  // the CTA is being burned in
  | 'preparing'  // thumbnail and product research
  | 'prepared'   // everything unattended is done, waiting for Launch
  | 'scheduled'  // YouTube has it and knows when to make it public
  | 'published'  // live on YouTube
  | 'amazon_only' // Liftoff set to Amazon only: handed to the Amazon side, never sent to YouTube
  | 'blocked'    // it cannot go, and `reason` says why

/** States the worker still has something to do about. */
export const OPEN_ITEM_STATES: ItemState[] = ['draft', 'rendering', 'preparing']

/** The CTA, chosen once and reproduced on every video in the batch.
 *
 *  `null` is a real answer meaning "no CTA on any of them", and it is stored as
 *  a decision rather than left undefined, so the worker can tell "they chose
 *  none" from "they have not chosen yet". */
export interface CtaPreset {
  /** Which burned-in design, by its id in lib/cta-stickers. */
  stickerId: string
  /** The resolved image, so a render never has to re-derive it. */
  stickerUrl: string
  style: 'lowerthird' | 'endcard'
  /** Fractions of the frame, exactly as the render route wants them. */
  widthPct: number
  xPct: number
  yPct: number
}

/**
 * Is this a CTA image we are willing to burn into somebody's video.
 *
 * ONLY OUR OWN. The preset is stored once and replayed by a background worker
 * onto ten videos with nobody watching, so an arbitrary URL here would be a
 * stored instruction to fetch and composite whatever it points at, every time.
 * The same two shapes the interactive route accepts: our CTA gallery, or a
 * badge we generated and put in our own storage.
 */
export function ctaStickerAllowed(url: string, supabaseUrl: string | undefined | null): boolean {
  const u = (url || '').trim()
  if (!u) return false
  if (/^https:\/\/[^/]+\/cta-burner\/[A-Za-z0-9._-]+\.png$/i.test(u)) return true
  const base = (supabaseUrl || '').replace(/\/+$/, '')
  return !!base
    && u.startsWith(`${base}/storage/v1/object/public/instagram-videos/`)
    && /\.png(\?|$)/i.test(u)
}

/** A preset we are prepared to store, or null with the reason. */
export function validateCtaPreset(
  raw: unknown, supabaseUrl: string | undefined | null,
): { ok: true; preset: CtaPreset } | { ok: false; error: string } {
  const c = (raw ?? {}) as Partial<CtaPreset>
  const url = String(c.stickerUrl || '')
  if (!ctaStickerAllowed(url, supabaseUrl)) {
    return { ok: false, error: 'That CTA design is not one of ours. Pick one from the gallery.' }
  }
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback
  }
  return {
    ok: true,
    preset: {
      stickerId: String(c.stickerId || '').slice(0, 80),
      stickerUrl: url,
      style: c.style === 'endcard' ? 'endcard' : 'lowerthird',
      // Clamped rather than trusted: a width of 40 would composite a badge
      // forty times the frame across ten videos before anyone saw one.
      widthPct: num(c.widthPct, 0.05, 1, 0.4),
      xPct: num(c.xPct, 0, 1, 0.55),
      yPct: num(c.yPct, 0, 1, 0.74),
    },
  }
}

export interface BatchRow {
  id: string
  name: string
  state: BatchState
  cta: CtaPreset | null
  /** Set the moment a CTA decision is made, INCLUDING the decision to use
   *  none. Without it, "no CTA" and "not asked yet" are the same empty value
   *  and the batch would sit waiting for an answer it already has. */
  cta_chosen?: boolean | null
  /** The thumbnail look, chosen once and replayed on all ten. Same reasoning
   *  as the CTA: one decision, reproduced, never a per-video copy to drift. */
  thumbnail: ThumbnailPreset | null
  /** Set the moment a thumbnail decision is made, INCLUDING keeping the house
   *  look, for the same reason cta_chosen exists. */
  thumbnail_chosen?: boolean | null
  markets: string[]
  daily_slots: string[]
  start_on: string | null
  timezone: string
  /** False when the creator chose Amazon only (migration 369). Absent reads
   *  as true: YouTube and Amazon, as every batch did before. */
  send_to_youtube?: boolean
}

/**
 * The batch's YouTube-or-not choice, attached to a batch already loaded.
 *
 * A SEPARATE READ, like every column added after launch, so a batch still
 * loads before migration 369 is run. `available: false` means the choice
 * cannot be saved yet, and the batch goes to YouTube as it always did.
 */
export async function withYouTubeChoice<B extends BatchRow>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, batch: B,
): Promise<{ batch: B; available: boolean }> {
  const { data, error } = await sb.from('launch_batches').select('send_to_youtube').eq('id', batch.id).maybeSingle()
  if (error) return { batch: { ...batch, send_to_youtube: true }, available: false }
  return { batch: { ...batch, send_to_youtube: data?.send_to_youtube !== false }, available: true }
}

/**
 * The columns a batch must be read with, wherever it is read.
 *
 * ONE LIST, AND THIS IS WHY. The page's route and the launch route each had
 * their own hand-written select. `thumbnail_chosen` was added to one and not
 * the other, so the launch route read it as undefined, decided the creator had
 * never answered the thumbnail step, and refused a batch whose Launch button
 * the page had just enabled. The comment in that route said "one function
 * decides what ready means" and it was true: the function was fine, and the two
 * callers were handing it different rows.
 *
 * A function cannot be the single source of truth about a row if its callers
 * disagree about which row to fetch. test-launch-batch checks every field
 * batchSteps and launchBlocker read appears here.
 */
export const BATCH_COLUMNS =
  'id,name,state,cta,cta_chosen,thumbnail,thumbnail_chosen,markets,daily_slots,start_on,timezone,created_at'

/** The columns an item must be read with, for the same reason. */
export const ITEM_COLUMNS =
  'id,position,source_url,rendered_url,clean_url,asin,title,title_source,description,thumbnail_url,thumbnail_clean_url,thumbnail_source,video_id,'
  + 'state,reason,publish_at,youtube_video_id,duration_seconds,render_tries,thumb_tries,thumbnail_set_at,thumbnail_error,updated_at,'
  // planned_publish_at and publish_tries: the only two facts that separate a
  // video waiting for YOU to press Launch from one waiting for the UPLOADER.
  // Both exist since migration 358, which launching already depends on.
  + 'planned_publish_at,publish_tries'

/**
 * Each video's own YouTube date and time, attached to rows already loaded.
 *
 * WHY A SEPARATE QUERY AND NOT TWO MORE NAMES IN ITEM_COLUMNS. main deploys
 * the moment it is pushed, and the SQL is run by hand afterwards. Had these
 * columns joined ITEM_COLUMNS, every item query would have failed in the gap
 * between the two, and a failed select comes back as `data: null`, which the
 * batch page reads as a batch with no videos in it. The creator would have
 * opened a batch of ten and been told to add some.
 *
 * So this is allowed to fail, and says so. `available: false` means migration
 * 364 has not been run: every video follows the pattern exactly as before, and
 * the page can say per-video times are not switched on rather than offering an
 * editor whose every save is refused.
 */
export async function withOwnSchedules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, batchId: string, items: ItemRow[],
): Promise<{ items: ItemRow[]; available: boolean }> {
  if (items.length === 0) return { items, available: true }
  const { data, error } = await sb.from('launch_items')
    .select('id,custom_publish_date,custom_publish_time').eq('batch_id', batchId)
  if (error) return { items, available: false }
  const byId = new Map<string, { custom_publish_date: string | null; custom_publish_time: string | null }>()
  for (const r of (data ?? []) as Array<{ id: string; custom_publish_date: string | null; custom_publish_time: string | null }>) {
    byId.set(r.id, r)
  }
  return {
    available: true,
    items: items.map((i) => ({
      ...i,
      custom_publish_date: byId.get(i.id)?.custom_publish_date ?? null,
      custom_publish_time: byId.get(i.id)?.custom_publish_time ?? null,
    })),
  }
}

export interface ItemRow {
  id: string
  position: number
  source_url: string | null
  rendered_url: string | null
  asin: string | null
  title: string | null
  thumbnail_url: string | null
  thumbnail_clean_url?: string | null
  state: ItemState
  reason: string | null
  publish_at?: string | null
  youtube_video_id?: string | null
  /** The videos row this item became once YouTube took it. Its presence is
   *  what the Amazon side has to reference, so it is also the honest answer to
   *  "is there anything for Amazon to do yet". */
  video_id?: string | null
  /** Where the title came from: 'filename', 'creator' or 'mvp'. Null means a
   *  row from before this was recorded, which is treated as 'filename'. */
  title_source?: string | null
  /** When YouTube accepted the thumbnail we designed. */
  thumbnail_set_at?: string | null
  /** What YouTube said if it refused it. The video is up either way, so this
   *  is a note on a working row rather than a failure of one. */
  thumbnail_error?: string | null
  /** This video's own YouTube date and time, set by the creator, as
   *  YYYY-MM-DD and HH:MM in the batch zone. Both null means it follows the
   *  batch pattern. Always both or neither (migration 364 enforces it). */
  custom_publish_date?: string | null
  custom_publish_time?: string | null
  /** Written by the launch route: set means Launch has been pressed and the
   *  uploader has it. Null on a prepared video means it is waiting for you. */
  planned_publish_at?: string | null
  /** Upload attempts so far. */
  publish_tries?: number | null
}

// ── the steps, which are the page's spine and the worker's contract ─────────

export type StepId = 'videos' | 'cta' | 'thumbnail' | 'countries' | 'products' | 'schedule'

export interface StepStatus {
  id: StepId
  /** The heading a creator reads. */
  title: string
  /** Done means done. Never "we asked for it". */
  done: boolean
  /** One line saying what is still needed, or what was chosen. THE SAME
   *  SENTENCE the worker would give, so a screen cannot be more optimistic
   *  than the thing doing the work. */
  detail: string
  /** True for the one step the creator should do next, so the page can lead
   *  rather than present five equal boxes. */
  current: boolean
}

/**
 * Where the batch is, step by step.
 *
 * Order matters and is the order of the page: you cannot pick a product for a
 * video you have not added, and there is no point choosing a cadence for a
 * batch with nothing in it. The FIRST incomplete step is the current one, so
 * the page always has exactly one thing to point at.
 */
export function batchSteps(batch: BatchRow, items: ItemRow[]): StepStatus[] {
  const n = items.length
  const withProduct = items.filter((i) => !!(i.asin || '').trim()).length
  const withTitle = items.filter((i) => !!(i.title || '').trim()).length
  // STILL THE UPLOAD'S FILE NAME. Counted rather than guessed at: "STEAM BRUSH
  // WORKS?" does not look like a file name, and the only thing that knows it
  // was one is the row that recorded where the title came from.
  const fileNamed = items.filter((i) => (i.title_source ?? 'filename') === 'filename').length
  // AN ASIN IS NOT A TITLE, AND THIS IS A BLOCK RATHER THAN A WARNING.
  //
  // The page warned about it under a step that was ticked green and said
  // "Every video has a product and a title". Both sentences were on screen at
  // once, and the tick is the one people believe. A title is the line that goes
  // on YouTube exactly as typed and is the source text every other country's
  // title is translated from, so shipping B0H3P7H9T2 costs ten listings, not
  // one field.
  const asinTitled = items.filter((i) => {
    const t = (i.title || '').trim().toUpperCase()
    const a = (i.asin || '').trim().toUpperCase()
    return !!t && !!a && t === a
  }).length
  const slots = normalizeSlots(batch.daily_slots)
  const ownTimed = items.filter((i) => hasOwnSchedule({
    id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time,
  })).length

  const steps: Array<Omit<StepStatus, 'current'>> = [
    {
      id: 'videos',
      title: 'Add your videos',
      done: n > 0,
      detail: n === 0
        ? `Up to ${MAX_ITEMS}. Each one is its own video with its own product.`
        : `${n} of ${MAX_ITEMS} added.`,
    },
    {
      id: 'cta',
      title: 'Choose your CTA',
      done: !!batch.cta_chosen,
      detail: !batch.cta_chosen
        ? 'Picked once and burned into every video in this batch.'
        : batch.cta
          ? 'Chosen. It goes on all of them in the same spot.'
          : 'No CTA on these, which is a choice you can change here.',
    },
    {
      id: 'thumbnail',
      title: 'Choose your thumbnail look',
      done: !!batch.thumbnail_chosen,
      detail: !batch.thumbnail_chosen
        ? 'The style, the face and the hook. Picked once, used on all of them.'
        : batch.thumbnail
          ? presetSummary(batch.thumbnail)
          : 'The house look on all of them, which is a choice you can change here.',
    },
    {
      id: 'countries',
      title: 'Pick your Amazon countries',
      done: batch.markets.length > 0,
      detail: batch.markets.length === 0
        ? 'Where these should end up. Non-English stores get a translation and a dub.'
        : `${batch.markets.length} ${batch.markets.length === 1 ? 'country' : 'countries'}.`,
    },
    {
      id: 'products',
      title: 'Set each product',
      // THE ONLY PER-VIDEO STEP, and the only one that cannot be shared: each
      // video sells a different thing.
      done: n > 0 && withProduct === n && withTitle === n && asinTitled === 0,
      detail: n === 0
        ? 'Add videos first.'
        // NAMED, NOT COUNTED, WHEN THERE IS ONLY ONE VIDEO. "1 still needs a
        // product" over a batch of one reads as a request for ANOTHER product,
        // and was read exactly that way: "why does it want more asin.. i only
        // uploaded 1 video". A count is only a count when there is something to
        // count against.
        : withProduct < n
          ? (n === 1
              ? 'Paste the ASIN or the Amazon link for your video.'
              : `${n - withProduct} of your ${n} still ${n - withProduct === 1 ? 'needs' : 'need'} a product.`)
          : withTitle < n
            ? (n === 1
                ? 'Your video still needs a title.'
                : `${n - withTitle} of your ${n} still ${n - withTitle === 1 ? 'needs' : 'need'} a title.`)
            : asinTitled > 0
              ? (n === 1
                  ? 'The title box has your ASIN in it. That would go on YouTube exactly as it reads. Press "Write it for me" or type one.'
                  : `${asinTitled} of your ${n} have an ASIN in the title box. That would go on YouTube exactly as it reads. Press "Write it for me" or type one.`)
              // NOT A BLOCK. A file name is a real string and the worker
              // replaces it with a written title before anything is built
              // from it. Saying so beats a green tick that hides it, because
              // a creator who wants to write their own needs to know which
              // ones are about to be written for them.
              : fileNamed > 0
                ? (n === 1
                    ? 'Your title is still the name of the file you uploaded. MVP writes one from the product unless you type your own.'
                    : `${fileNamed} of your ${n} still carry the name of the file you uploaded. MVP writes those from the product unless you type your own.`)
                : 'Every video has a product and a title.',
    },
    {
      id: 'schedule',
      // NAMED FOR YOUTUBE, because that is the only thing this schedules.
      // "Set the cadence" said nothing about which platform, and the first
      // person to read it asked where YouTube had gone. Amazon is not on a
      // cadence at all: each listing goes up as soon as its dub is ready.
      title: 'Schedule your YouTube posts',
      // DONE WHEN EVERY VIDEO HAS A TIME, whichever way it got one. A batch
      // where the creator set all ten by hand needs no pattern at all, and
      // holding its Launch button until they also filled one in would be
      // asking for a setting that changes nothing.
      // AMAZON ONLY NEEDS NO SCHEDULE: nothing waits for a YouTube slot.
      done: n > 0 && (
        batch.send_to_youtube === false
        || ownTimed === n
        || (slots.length > 0 && !!batch.start_on)
      ),
      detail: batch.send_to_youtube === false
        ? 'Amazon only: no YouTube schedule. Each video goes to your storefronts once it is ready.'
        : ownTimed === n && n > 0
        ? (n === 1 ? 'Your video has its own date and time.' : `All ${n} videos have their own date and time.`)
        : slots.length === 0
          ? (ownTimed > 0
              ? `${ownTimed} of ${n} have their own time. Give the rest one, or set a daily pattern for them.`
              : 'Pick a date and time for each video, or set a daily pattern.')
          : !batch.start_on
            ? `${cadenceLabel(slots)} on YouTube. Pick the first day.`
            : ownTimed > 0
              ? `${ownTimed} on their own time, the rest ${cadenceLabel(slots).toLowerCase()} from ${batch.start_on}.`
              : `${cadenceLabel(slots)} on YouTube, from ${batch.start_on}.`,
    },
  ]

  const firstOpen = steps.findIndex((s) => !s.done)
  return steps.map((s, i) => ({ ...s, current: i === firstOpen }))
}

/** Can this batch be launched, and if not, the first reason why.
 *
 *  ONE SENTENCE, naming the step. A disabled button with no explanation is the
 *  dead end this codebase keeps producing. */
export function launchBlocker(batch: BatchRow, items: ItemRow[]): string | null {
  if (items.length === 0) return 'Add at least one video first.'
  const steps = batchSteps(batch, items)
  const open = steps.find((s) => !s.done)
  if (open) return `${open.title}: ${open.detail}`
  // Nothing unattended may still be running, or Launch would schedule a video
  // whose CTA is half burned in.
  const busy = items.filter((i) => i.state === 'draft' || i.state === 'rendering' || i.state === 'preparing')
  if (busy.length > 0) {
    return `${busy.length} ${busy.length === 1 ? 'video is' : 'videos are'} still being prepared. This finishes on its own.`
  }
  const usable = items.filter((i) => i.state === 'prepared')
  if (usable.length === 0) return 'Nothing is ready to launch. Check the videos below for what is in the way.'
  return null
}

/**
 * Why this batch cannot reach YouTube at all, whatever its steps say.
 *
 * CHECKED BEFORE LAUNCH, NOT AFTER THREE TRIES. A batch with no channel that
 * can push runs the whole pipeline, uploads nothing, and reports "YouTube would
 * not take this video after 3 tries" on every single video. That is the most
 * expensive possible moment to learn something we knew before the button was
 * pressed, and it is the failure the first real batch actually hit.
 *
 * SEPARATE FROM launchBlocker because it needs a database lookup and that
 * function is pure. Both are called from one place, so the page and the launch
 * route cannot disagree about it.
 */
export function channelBlocker(hasPushChannel: boolean): string | null {
  if (hasPushChannel) return null
  return 'No YouTube channel is connected for uploading. Connect one under Settings, then launch. Everything you have set up here is kept.'
}

/**
 * A name a batch can arrive with.
 *
 * "Untitled batch" three times in a row is not a list, it is three identical
 * buttons. The date is the one thing that always exists at the moment a batch
 * is created and is what somebody actually uses to tell two of them apart, so
 * it is the default rather than a placeholder that names nothing.
 *
 * NEVER THE YEAR. Everything here is made and used inside a few weeks, and a
 * year in a name reads as stale the moment it is not the current one.
 */
export function defaultBatchName(now: Date = new Date(), timezone?: string): string {
  try {
    const d = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || undefined, day: 'numeric', month: 'short',
    }).format(now)
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || undefined, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now)
    return `${d}, ${t}`
  } catch {
    return 'New batch'
  }
}

/**
 * Can this step be left alone.
 *
 * WHY IT HAS TO BE SAID. Six numbered steps with green ticks read as six
 * things you must do, so a creator works through the CTA gallery and the
 * twenty thumbnail looks believing the batch will not go without them. Two of
 * the six have a perfectly good answer that is "leave it as it is", and not
 * saying so turns a two minute setup into a twenty minute one.
 *
 * They still have to be ANSWERED, which is the distinction: keeping the house
 * look is a decision, and the batch waits until one is made either way.
 */
export function stepIsOptional(id: StepId): boolean {
  return id === 'cta' || id === 'thumbnail'
}

/**
 * Every decision this batch carries, in plain sentences.
 *
 * READ BEFORE THE IRREVERSIBLE BUTTON. The settings are spread over six
 * collapsed steps, and the moment they all matter at once is the moment
 * somebody is about to publish. Scrolling back through six accordions to
 * check what you chose is not reviewing, it is hoping.
 */
export function batchRecap(batch: BatchRow, items: ItemRow[]): string[] {
  const out: string[] = []
  const n = items.filter((i) => i.state === 'prepared').length
  const blocked = items.filter((i) => i.state === 'blocked').length

  out.push(`${n} ${n === 1 ? 'video goes' : 'videos go'} out${blocked > 0 ? `, and ${blocked} cannot` : ''}.`)
  out.push(batch.cta
    ? 'Your CTA is burned into every one of them, in the same spot.'
    : 'No CTA is burned into any of them.')
  out.push(batch.thumbnail
    ? presetSummary(batch.thumbnail)
    : 'Thumbnails use your brand\u2019s usual look.')

  const slots = normalizeSlots(batch.daily_slots)
  const own = items.filter((i) => i.state === 'prepared' && hasOwnSchedule({
    id: i.id, customDate: i.custom_publish_date, customTime: i.custom_publish_time,
  })).length
  // SAID AS IT IS. A summary reading "One a day, at 17:00" over a batch where
  // most videos have their own time would be the pattern reported as the plan.
  if (batch.send_to_youtube === false) out.push('Nothing goes to YouTube: Amazon only, as you chose.')
  else if (own > 0 && own === n) out.push(`Every video goes out on YouTube at the date and time you gave it.`)
  else if (own > 0) out.push(`${own} on YouTube at their own date and time, the rest ${cadenceLabel(slots).toLowerCase()}${batch.start_on ? `, starting ${batch.start_on}` : ''}.`)
  else out.push(`${cadenceLabel(slots)} on YouTube${batch.start_on ? `, starting ${batch.start_on}` : ''}.`)

  if (batch.markets.length === 0) out.push('No Amazon storefronts, so this is YouTube only.')
  else {
    out.push(`${batch.markets.length} Amazon ${batch.markets.length === 1 ? 'storefront' : 'storefronts'}, each one as soon as its translation and dub are done, not on the YouTube schedule.`)
  }
  return out
}

/**
 * Roughly how long the unattended half still has to run.
 *
 * WHY A NUMBER AND NOT A SPINNER. The whole promise is "press Launch and walk
 * away", and nobody walks away from a screen that will not say how long. The
 * drain fires once a minute and does one image per firing, so the arithmetic is
 * real rather than a guess: two images per video, plus a render for any video
 * that still needs its CTA burned in.
 *
 * STATED AS A FLOOR, not a promise. It counts firings, and a firing can be
 * spent on a retry, so the honest word is "about".
 */
export function minutesLeft(items: ItemRow[]): number {
  let firings = 0
  for (const i of items) {
    if (i.state === 'draft' || i.state === 'rendering') firings += 1  // the CTA burn
    if (i.state === 'draft' || i.state === 'rendering' || i.state === 'preparing') {
      // Two images each, minus whichever is already built.
      firings += (i.thumbnail_url ? 0 : 1) + (i.thumbnail_clean_url ? 0 : 1)
    }
  }
  return firings
}

/** The same thing in words, or null when there is nothing left to wait for. */
export function prepEta(items: ItemRow[]): string | null {
  const mins = minutesLeft(items)
  if (mins <= 0) return null
  if (mins === 1) return 'About a minute of preparing left.'
  if (mins < 60) return `About ${mins} minutes of preparing left. You can close this tab.`
  const h = Math.round(mins / 60)
  return `About ${h} ${h === 1 ? 'hour' : 'hours'} of preparing left. You can close this tab.`
}

/** Plain words for an item state, so no screen invents its own. */
export function itemStateLabel(state: ItemState): string {
  switch (state) {
    case 'draft':     return 'Waiting to start'
    case 'rendering': return 'Burning in your CTA'
    case 'preparing': return 'Building the thumbnail'
    case 'prepared':  return 'Ready to launch'
    case 'scheduled': return 'Scheduled on YouTube'
    case 'published': return 'Live on YouTube'
    case 'amazon_only': return 'Sent to Amazon (YouTube skipped)'
    case 'blocked':   return 'Cannot go'
    default:          return 'Unknown'
  }
}

/**
 * The label a video's row actually shows, which is more than its state.
 *
 * "READY TO LAUNCH" UNDER A BATCH THAT SAID "LAUNCHED". A prepared video is
 * one of two very different things: waiting for the creator to press Launch,
 * or already launched and waiting for the uploader, which runs every minute.
 * The state is 'prepared' in both, so the row said "Ready to launch" in both,
 * and the first creator to launch a batch sat under a green "Launched" button
 * reading "Ready to launch" beside each video, wondering what else to press.
 * planned_publish_at is what tells them apart: only the launch route writes
 * it. And an attempt in progress says so, because "queued" one second in and
 * ten minutes in is the working-versus-stuck failure again.
 */
export function itemProgressLabel(i: {
  state: ItemState; planned_publish_at?: string | null; publish_tries?: number | null; reason?: string | null
}): string {
  // ON THE CHANNEL, PRIVATE, WAITING FOR A TIME. Not "Cannot go": it went,
  // and the uploader deliberately did not make it public because its slot
  // passed before it was ready.
  if (i.state === 'blocked' && /^Kept private\./.test(String(i.reason ?? ''))) return 'On YouTube, kept private'
  if (i.state === 'prepared' && i.planned_publish_at) {
    if (/^Attempt \d+ of \d+ is running now\.$/.test(String(i.reason ?? ''))) return 'Uploading to YouTube'
    if (Number(i.publish_tries ?? 0) > 0) return 'Upload will be tried again'
    return 'Queued for YouTube'
  }
  return itemStateLabel(i.state)
}

/** The colour for that label. Queued and uploading are MOVING, not done, so
 *  they are not green: green is only for states that really are finished. */
export function itemProgressTone(i: {
  state: ItemState; planned_publish_at?: string | null; publish_tries?: number | null
}): 'good' | 'busy' | 'warn' | 'idle' {
  if (i.state === 'prepared' && i.planned_publish_at) {
    return Number(i.publish_tries ?? 0) > 0 ? 'warn' : 'busy'
  }
  return itemStateTone(i.state)
}

// ── what actually happened to a batch that was launched ────────────────────
//
// THE BOX THAT LIED. After Launch, the page drew a green panel reading
// "1 video scheduled" with the first and last publication times under it, and
// that panel was built from the launch call's own reply: a count of rows the
// worker had been ASKED to publish, captured once and never looked at again.
//
// So when the worker then failed, the page said both things at once. The green
// panel still read "1 video scheduled", and the board directly underneath it
// read "Cannot go: YouTube would not take this video after 3 tries". A creator
// looking at that has no way to tell which half is true, and the wrong half was
// the loud one.
//
// THIS COUNTS ROWS INSTEAD. Every number below comes from the same states the
// board paints, so the summary cannot disagree with the list under it.

export interface LaunchOutcome {
  total: number
  /** Really on YouTube: uploaded and either scheduled or already public. */
  onYouTube: number
  /** Still moving. Worth waiting for, not worth worrying about. */
  working: number
  /** Stopped, with a reason on the row. */
  blocked: number
  /** Handed to the Amazon side, which needs a YouTube id to reference. */
  handedOver: number
  tone: 'good' | 'busy' | 'warn'
  /** The one sentence at the top of the panel. */
  headline: string
  /** Why Amazon cannot run yet, or null when it can. The button reads this
   *  rather than finding out after it is pressed. */
  amazonBlocker: string | null
}

export function launchOutcome(items: {
  state: ItemState; video_id?: string | null; planned_publish_at?: string | null
}[]): LaunchOutcome {
  const total = items.length
  const onYouTube = items.filter((i) => i.state === 'scheduled' || i.state === 'published').length
  // Amazon only: finished with YouTube by choice, not waiting on it.
  const amazonOnly = items.filter((i) => i.state === 'amazon_only').length
  const blocked = items.filter((i) => i.state === 'blocked').length
  const working = total - onYouTube - blocked - amazonOnly
  const handedOver = items.filter((i) => !!i.video_id).length
  // Finished preparing and handed to the uploader. "Still being prepared" was
  // said about these too, which was false twice over: preparing was done, and
  // the thing actually happening was an upload.
  const queued = items.filter((i) => i.state === 'prepared' && !!i.planned_publish_at).length

  // WORST NEWS FIRST. A batch that is half broken is a batch somebody has to
  // act on, and burying that under a count of the ones that worked is how the
  // old panel managed to be green while nothing had published.
  let tone: LaunchOutcome['tone'] = 'good'
  let headline = ''
  // "COULD NOT GO" IS NOT TRUE OF EVERY BLOCKED ROW any more. A video kept
  // private after its slot passed is on the channel. What is true of every
  // blocked row is that it needs the creator, so that is what is said.
  if (blocked > 0 && onYouTube === 0) {
    tone = 'warn'
    headline = total === 1
      ? 'This one needs you. The reason is below.'
      : `None of these went public on their own. ${blocked} ${blocked === 1 ? 'needs' : 'need'} you, with the reason below.`
  } else if (blocked > 0) {
    tone = 'warn'
    headline = `${onYouTube} of ${total} on YouTube. ${blocked} ${blocked === 1 ? 'needs' : 'need'} you, with the reason below.`
  } else if (working > 0) {
    tone = 'busy'
    const allQueued = queued === working
    headline = onYouTube === 0
      ? (allQueued
          ? `${working} of ${total} queued for YouTube. The uploader runs every minute.`
          : `${working} of ${total} still being prepared. Nothing is on YouTube yet.`)
      : (allQueued
          ? `${onYouTube} of ${total} on YouTube, ${working} queued for upload.`
          : `${onYouTube} of ${total} on YouTube, ${working} still working.`)
  } else if (amazonOnly > 0 && onYouTube === 0) {
    headline = total === 1 ? 'Handed to Amazon. YouTube skipped, as you chose.' : `All ${total} handed to Amazon. YouTube skipped, as you chose.`
  } else {
    headline = total === 1 ? 'On YouTube.' : `All ${total} on YouTube.`
  }

  // ON YOUTUBE AND NOT YET HANDED OVER ARE DIFFERENT SENTENCES. The old line
  // keyed only on the hand-over, so while it was failing silently it told a
  // creator "Nothing is on YouTube yet" under a video they could see live on
  // their channel. What is true in that gap is that the video IS on YouTube
  // and the Amazon side has not picked it up.
  const amazonBlocker = handedOver > 0
    ? null
    : amazonOnly > 0
      ? 'Being passed to the Amazon side. This opens as soon as that is done, usually within a minute.'
    : onYouTube === 0
      ? 'Nothing is on YouTube yet, so there is no video for Amazon to list. That happens first.'
      : `${onYouTube === 1 ? 'Your video is' : `${onYouTube} videos are`} on YouTube and being passed to the Amazon side. This opens as soon as that is done, usually within a minute.`

  return { total, onYouTube, working, blocked, handedOver, tone, headline, amazonBlocker }
}

/** The colour a state reads as. Green only for states that really are done. */
export function itemStateTone(state: ItemState): 'good' | 'busy' | 'warn' | 'idle' {
  switch (state) {
    case 'published': return 'good'
    case 'amazon_only': return 'good'
    case 'scheduled': return 'good'
    case 'prepared':  return 'good'
    case 'rendering':
    case 'preparing': return 'busy'
    case 'blocked':   return 'warn'
    default:          return 'idle'
  }
}
