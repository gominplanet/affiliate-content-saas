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

import { normalizeSlots, cadenceLabel } from '@/lib/launch-schedule'

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
  markets: string[]
  daily_slots: string[]
  start_on: string | null
  timezone: string
}

export interface ItemRow {
  id: string
  position: number
  source_url: string | null
  rendered_url: string | null
  asin: string | null
  title: string | null
  thumbnail_url: string | null
  state: ItemState
  reason: string | null
  publish_at?: string | null
  youtube_video_id?: string | null
}

// ── the steps, which are the page's spine and the worker's contract ─────────

export type StepId = 'videos' | 'cta' | 'countries' | 'products' | 'schedule'

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
  const slots = normalizeSlots(batch.daily_slots)

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
      done: n > 0 && withProduct === n && withTitle === n,
      detail: n === 0
        ? 'Add videos first.'
        : withProduct < n
          ? `${n - withProduct} still ${n - withProduct === 1 ? 'needs' : 'need'} a product.`
          : withTitle < n
            ? `${n - withTitle} still ${n - withTitle === 1 ? 'needs' : 'need'} a title.`
            : 'Every video has a product and a title.',
    },
    {
      id: 'schedule',
      title: 'Set the cadence and launch',
      done: slots.length > 0 && !!batch.start_on,
      detail: slots.length === 0
        ? 'How many a day, and at what times.'
        : !batch.start_on
          ? `${cadenceLabel(slots)}. Pick the first day.`
          : `${cadenceLabel(slots)}, from ${batch.start_on}.`,
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

/** Plain words for an item state, so no screen invents its own. */
export function itemStateLabel(state: ItemState): string {
  switch (state) {
    case 'draft':     return 'Waiting to start'
    case 'rendering': return 'Burning in your CTA'
    case 'preparing': return 'Building the thumbnail'
    case 'prepared':  return 'Ready to launch'
    case 'scheduled': return 'Scheduled on YouTube'
    case 'published': return 'Live on YouTube'
    case 'blocked':   return 'Cannot go'
    default:          return 'Unknown'
  }
}

/** The colour a state reads as. Green only for states that really are done. */
export function itemStateTone(state: ItemState): 'good' | 'busy' | 'warn' | 'idle' {
  switch (state) {
    case 'published': return 'good'
    case 'scheduled': return 'good'
    case 'prepared':  return 'good'
    case 'rendering':
    case 'preparing': return 'busy'
    case 'blocked':   return 'warn'
    default:          return 'idle'
  }
}
