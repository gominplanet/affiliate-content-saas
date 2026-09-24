// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What SCOUT does in YouTube Studio, and how a screen reports it.
//
// ONE PLACE FOR BOTH SCREENS. Co-Pilot and Launch Batch both send SCOUT into
// Studio, and both used to write their own sentence about what happened. Co-
// Pilot's said "Paid promotion checked, AI-use answered, notify off" whenever
// the step came back ok, and the step came back ok on a click, not on a read.
// Studio showed the box blank. So the words now come from the step's own
// detail, which SCOUT writes after reading the control back, and the tick
// comes from `ok`, which it only sets on that read.

import type { StudioFinishResult, StudioFinishStep, StudioVisibility } from './extension-frame'

/** The creator's choices for the Studio pass. Stored per Launch Batch. */
export interface StudioOptions {
  /** Paid promotion YES and AI use NO, on the Details page. */
  disclosures: boolean
  /** Monetization On, when the channel has it. */
  monetize: boolean
  /** Ad suitability: None of the above, then Submit rating. */
  adRating: boolean
  /** Tag the video's product, when there is one and the channel can. */
  tagProduct: boolean
  /** End screen imported from the channel's latest video. */
  endScreen: boolean
}

/** The creator's own steps, all on. Nothing runs until they press the button
 *  that starts the Studio pass, and every one of these is a visible checkbox
 *  beside it. */
export const DEFAULT_STUDIO_OPTIONS: StudioOptions = {
  disclosures: true,
  monetize: true,
  adRating: true,
  tagProduct: true,
  endScreen: true,
}

/** Whatever is stored, as a full set of booleans. Unknown keys are dropped and
 *  a missing one takes its default, so an old row reads as the defaults. */
export function normalizeStudioOptions(raw: unknown): StudioOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = (k: keyof StudioOptions) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : DEFAULT_STUDIO_OPTIONS[k])
  return {
    disclosures: pick('disclosures'),
    monetize: pick('monetize'),
    adRating: pick('adRating'),
    tagProduct: pick('tagProduct'),
    endScreen: pick('endScreen'),
  }
}

/** The product link SCOUT pastes into Tag products. An Amazon product page
 *  resolves to the product itself in YouTube's search. */
export function productLinkFor(asin: string | null | undefined): string | null {
  const a = String(asin || '').trim().toUpperCase()
  return /^[A-Z0-9]{10}$/.test(a) ? `https://www.amazon.com/dp/${a}` : null
}

const LABELS: Record<string, string> = {
  open: 'Open in Studio',
  details: 'Paid promotion, AI use, notify',
  next: 'Next page',
  monetization: 'Monetization',
  adsuit: 'Ad suitability rating',
  tagproduct: 'Tag product',
  endscreen: 'End screen',
  checks: 'Checks',
  visibility: 'Schedule',
  unknown: 'Studio page',
}

export function studioStepLabel(step: string): string {
  return LABELS[step] ?? step
}

export type StudioTone = 'good' | 'bad' | 'note' | 'idle'

/**
 * FOUR STATES, NOT TWO. Done, failed, not needed and not reached are
 * different facts, and a creator scanning the list must be able to tell them
 * apart without reading. "Not reached" especially: it used to be absent, so
 * a run that stopped at the disclosure listed only the one failure and looked
 * like everything else had been fine.
 */
export function studioStepTone(s: StudioFinishStep): StudioTone {
  if (s.ok) return 'good'
  if (s.notReached) return 'idle'
  // Done but not confirmable (an end screen on a video's own page), or not
  // needed: amber, never green and never red.
  if (s.skipped || s.partial) return 'note'
  return 'bad'
}

export function studioStepText(s: StudioFinishStep): string {
  if (s.detail) return s.detail
  if (s.ok) return 'Done'
  if (s.notReached) return 'Not reached'
  if (s.skipped) return 'Not needed'
  return s.error ? `Did not work: ${s.error}` : 'Did not work'
}

/** The line above the list. Only "every step read back" when every step that
 *  was asked for actually did. */
export function studioRunHeadline(r: StudioFinishResult): string {
  if (r.error === 'not-installed') return 'SCOUT is not installed or did not answer'
  if (r.error === 'timeout') return 'YouTube Studio took too long, so SCOUT stopped. Nothing after the last tick was done.'
  if (r.error === 'busy') return 'SCOUT is already working on another video in Studio. Try again when it finishes.'
  const asked = r.steps.filter((s) => !s.skipped)
  const done = asked.filter((s) => s.ok)
  if (asked.length === 0) return r.error ? `SCOUT could not start: ${r.error}` : 'Nothing was asked of SCOUT'
  if (done.length === asked.length) return 'Done in Studio. Every setting was read back.'
  const first = asked.find((s) => !s.ok && !s.notReached)
  // "STOPPED" ONLY WHEN IT STOPPED. A step that could not be confirmed, with
  // everything after it done, is not a stop, and saying so sent people
  // looking for a failure that was not there.
  const stopped = asked.some((s) => s.notReached)
  if (first && stopped) return `Stopped at ${studioStepLabel(first.step)}. ${done.length} of ${asked.length} done.`
  const open = asked.filter((s) => !s.ok).map((s) => studioStepLabel(s.step))
  return `${done.length} of ${asked.length} confirmed in Studio. Check: ${open.join(', ')}.`
}

/** Which way Studio went, said plainly. */
export function studioPathNote(path: StudioFinishResult['path']): string | null {
  if (path === 'draft') return 'Studio showed this video as a draft, so SCOUT used Edit draft and went through it page by page.'
  if (path === 'video') return 'This video is not a draft, so SCOUT used its own Studio pages. Its time is set through YouTube.'
  if (path === 'unknown') return 'Studio showed neither a draft nor the video page.'
  return null
}

/** Did the draft's own Schedule / Publish / Save button get pressed, and read
 *  back as done? When not, the caller sets the time through the YouTube API
 *  instead, but only if the disclosures read back. */
export function studioSetVisibility(r: StudioFinishResult | null): boolean {
  if (!r || r.path !== 'draft') return false
  const v = r.steps.find((s) => s.step === 'visibility')
  return !!(v && v.ok)
}

/** Did the disclosure answers read back as set? The gate for anything that
 *  makes a video public. */
export function studioDisclosuresConfirmed(r: StudioFinishResult | null): boolean {
  if (!r) return false
  const d = r.steps.find((s) => s.step === 'details')
  return !!(d && d.ok)
}

/** A visibility instruction for a draft, from a publish time or a choice. */
export function draftVisibility(publishAt: string | null, privacy: string): StudioVisibility {
  if (publishAt) return { mode: 'schedule', publishAt }
  if (privacy === 'public' || privacy === 'private' || privacy === 'unlisted') return { mode: privacy }
  return { mode: 'keep' }
}

/** A compact copy of a run for a database row: what each step said, no debug
 *  maps (they can hold a page's worth of text). */
export interface StoredStudioRun {
  at: string
  ok: boolean
  path: StudioFinishResult['path'] | null
  error: string | null
  steps: Array<Pick<StudioFinishStep, 'step' | 'ok' | 'skipped' | 'notReached' | 'detail'>>
}

export function storeStudioRun(r: StudioFinishResult, at: Date = new Date()): StoredStudioRun {
  return {
    at: at.toISOString(),
    ok: r.ok,
    path: r.path ?? null,
    error: r.error ?? null,
    steps: r.steps.map((s) => ({
      step: String(s.step).slice(0, 30),
      ok: !!s.ok,
      skipped: !!s.skipped,
      notReached: !!s.notReached,
      detail: String(s.detail ?? '').slice(0, 240),
    })),
  }
}

/** Read a stored run back, refusing anything that is not one. */
export function readStudioRun(raw: unknown): StoredStudioRun | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.at !== 'string' || !Array.isArray(o.steps)) return null
  return {
    at: o.at,
    ok: o.ok === true,
    path: (o.path === 'draft' || o.path === 'video' || o.path === 'unknown') ? o.path : null,
    error: typeof o.error === 'string' ? o.error : null,
    steps: (o.steps as unknown[]).filter((s) => s && typeof s === 'object').map((s) => {
      const x = s as Record<string, unknown>
      return {
        step: String(x.step ?? ''),
        ok: x.ok === true,
        skipped: x.skipped === true,
        notReached: x.notReached === true,
        detail: String(x.detail ?? ''),
      }
    }),
  }
}
