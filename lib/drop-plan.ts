// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DROP (Labs, admin while it is tested; Seb, 2026-10-17: "a very easy way for
// people to just drop their videos ... a launch button"). The creator drops
// finished videos, says once where each one goes, and presses Launch.
//
// NOTHING HERE IS A NEW ENGINE. A long video goes to YouTube and Amazon through
// a Liftoff batch the drop builds with the creator's own last Liftoff choices
// (CTA, thumbnail look, times, channel, playlist). Its blog post is scheduled
// to go live after the video. A vertical video goes to a TRYBE brand through
// SCOUT (lib/trybe-submit). This file is the plain rules in between, pure, so
// scripts/test-drop.ts can hold them.

import { normalizeSlots, parseSlot, todayIn, zonedTimeToInstant, cadenceLabel } from '@/lib/launch-schedule'
import { itemProgressLabel, itemProgressTone, MAX_ITEMS, type ItemState } from '@/lib/launch-batch'

/** A drop holds what one Liftoff batch holds. */
export const DROP_MAX = MAX_ITEMS

export type DropKind = 'long' | 'vertical'

/** Vertical only when the frame says so. A file whose size the browser could
 *  not read is treated as long, and the card says the size is unknown, rather
 *  than guessing it is a Short. */
export function dropKind(width: number, height: number): DropKind {
  return width > 0 && height > 0 && height > width ? 'vertical' : 'long'
}

export interface DropDest { liftoff: boolean; blog: boolean; trybe: boolean }

/** Where a video goes unless the creator says otherwise: a long video to
 *  YouTube, Amazon and the blog; a vertical one to TRYBE. */
export function defaultDest(kind: DropKind, hasBlog: boolean): DropDest {
  return kind === 'long' ? { liftoff: true, blog: hasBlog, trybe: false } : { liftoff: false, blog: false, trybe: true }
}

// ── The creator's own last Liftoff choices ───────────────────────────────────

/** The launch_batches columns a drop copies, as the row has them. */
export interface LastBatch {
  id: string
  name: string | null
  cta: unknown
  cta_chosen: boolean | null
  thumbnail: unknown
  thumbnail_chosen: boolean | null
  markets: string[] | null
  daily_slots: string[] | null
  timezone: string | null
  notify_subscribers?: boolean | null
  playlist_id?: string | null
  studio_options?: unknown
  send_to_youtube?: boolean | null
  youtube_channel_id?: string | null
}

/** The body for PATCH /api/launch/batches/{id} that gives a new batch the
 *  shared choices of the last one, through Liftoff's own checks. Only what
 *  was actually decided is sent: a choice never made stays open, so Liftoff
 *  asks for it instead of the drop inventing one. Pure. */
export function copiedSettings(last: LastBatch, timezone: string, startOn: string): Record<string, unknown> {
  const body: Record<string, unknown> = { timezone, startOn }
  if (last.cta_chosen) { body.ctaChosen = true; body.cta = last.cta ?? null }
  if (last.thumbnail_chosen) { body.thumbnailChosen = true; body.thumbnail = last.thumbnail ?? null }
  if (Array.isArray(last.markets)) body.markets = last.markets
  const slots = normalizeSlots(last.daily_slots)
  if (slots.length) body.dailySlots = slots
  if (typeof last.notify_subscribers === 'boolean') body.notifySubscribers = last.notify_subscribers
  if (last.playlist_id !== undefined) body.playlistId = last.playlist_id ?? null
  if (last.studio_options && typeof last.studio_options === 'object') body.studioOptions = last.studio_options
  if (typeof last.send_to_youtube === 'boolean') body.sendToYouTube = last.send_to_youtube
  return body
}

/** What the copy carries, in words, and what it leaves for Liftoff to ask. */
export function planWords(last: LastBatch | null): { lines: string[]; missing: string[] } {
  if (!last) return { lines: [], missing: ['your CTA', 'your thumbnail look', 'your posting times', 'your YouTube channel'] }
  const lines: string[] = []
  const missing: string[] = []
  if (last.send_to_youtube === false) lines.push('Amazon only, nothing to YouTube (as your last batch)')
  if (last.cta_chosen) lines.push(last.cta ? 'Your CTA, in the same spot' : 'No CTA (your last choice)')
  else missing.push('your CTA')
  if (last.thumbnail_chosen) lines.push(last.thumbnail ? 'Your thumbnail look' : 'The house thumbnail look (your last choice)')
  else missing.push('your thumbnail look')
  const slots = normalizeSlots(last.daily_slots)
  if (last.send_to_youtube !== false) {
    if (slots.length) lines.push(`${cadenceLabel(slots)} on YouTube`)
    else missing.push('your posting times')
    if (last.youtube_channel_id) lines.push('The YouTube channel you confirmed last time')
    else missing.push('your YouTube channel')
    if (last.playlist_id) lines.push('Added to the same playlist')
  }
  if ((last.markets ?? []).length) lines.push('Then the US Amazon store')
  return { lines, missing }
}

/** The first day a drop goes out: today while today's first time is still at
 *  least `leadMinutes` ahead, else tomorrow. Liftoff publishes a time that went
 *  by earlier today straight away, which is not what "drop and walk away"
 *  means when the video still has to be prepared and uploaded. Pure. */
export function firstDay(slots: string[] | null | undefined, timezone: string, now: Date = new Date(), leadMinutes = 90): { startOn: string; today: boolean } {
  const today = todayIn(timezone, now)
  const first = normalizeSlots(slots)[0]
  const m = first ? parseSlot(first) : null
  const [y, mo, d] = today.split('-').map(Number)
  if (m != null) {
    const at = zonedTimeToInstant(y, mo, d, m, timezone)
    if (at.getTime() - now.getTime() >= leadMinutes * 60_000) return { startOn: today, today: true }
  }
  const t = new Date(Date.UTC(y, mo - 1, d + 1))
  return { startOn: t.toISOString().slice(0, 10), today: false }
}

/** The first day for the creator's pick: MVP's suggestion (firstDay), today
 *  whatever the time, or tomorrow. Pure. */
export function startFor(choice: 'auto' | 'today' | 'tomorrow', slots: string[] | null | undefined, timezone: string, now: Date = new Date()): { startOn: string; today: boolean } {
  if (choice === 'auto') return firstDay(slots, timezone, now)
  const today = todayIn(timezone, now)
  if (choice === 'today') return { startOn: today, today: true }
  const [y, mo, d] = today.split('-').map(Number)
  return { startOn: new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10), today: false }
}

// ── Launch when Liftoff has prepared it ──────────────────────────────────────

/** Liftoff's reason that only needs waiting out. */
export const isStillPreparing = (blocker: string | null | undefined) => /still being prepared/i.test(String(blocker ?? ''))

export type BatchNext = 'launch' | 'wait' | 'needs_you' | 'launched'

/** What a drop does next with its batch, from Liftoff's own answer (GET
 *  /api/launch/batches/{id}): the state and the reason Launch is refused. */
export function nextForBatch(state: string, blocker: string | null | undefined): BatchNext {
  if (state === 'launching' || state === 'launched') return 'launched'
  if (!blocker) return 'launch'
  return isStillPreparing(blocker) ? 'wait' : 'needs_you'
}

// ── The blog post, after the video ───────────────────────────────────────────

/** When the blog post goes live: ten minutes after the video is public, so
 *  the post never embeds a private video. A video already public gets its
 *  post ten minutes from now. Null until YouTube confirmed a time. Pure. */
export function blogTimeFor(publishAt: string | null | undefined, now: Date = new Date()): string | null {
  const t = Date.parse(String(publishAt ?? ''))
  if (!Number.isFinite(t)) return null
  return new Date(Math.max(t, now.getTime()) + 10 * 60_000).toISOString()
}

/** Is a video ready for its blog post: in MVP's video list (the blog writes
 *  from that row) with a time YouTube confirmed. */
export function blogReady(li: { video_id?: string | null; publish_at?: string | null; state?: string | null } | null | undefined): boolean {
  return !!li?.video_id && !!li.publish_at && (li.state === 'scheduled' || li.state === 'published')
}

// ── The board: per video, per place, what actually happened ──────────────────

export type Tone = 'good' | 'busy' | 'warn' | 'bad' | 'idle'

/** A blog post or TRYBE send quiet this long stopped with the page that ran
 *  it: the board says so and offers to run it again (app/api/drop STALE_MS). */
export const STALE_MS = 20 * 60_000
export const isStale = (updatedAt: string | null | undefined, now: number = Date.now()) => {
  const t = Date.parse(String(updatedAt ?? ''))
  return Number.isFinite(t) && now - t > STALE_MS
}
export interface PlaceLine { place: 'YouTube' | 'Amazon' | 'Blog' | 'TRYBE'; tone: Tone; text: string }

export interface DropItemRow {
  id: string
  kind: DropKind
  to_liftoff: boolean
  to_blog: boolean
  to_trybe: boolean
  launch_item_id: string | null
  blog_state: string
  blog_detail: string | null
  blog_url: string | null
  blog_at: string | null
  trybe_state: string
  trybe_brand_name: string | null
  trybe_detail: string | null
  updated_at?: string | null
}

export interface LaunchItemView {
  state: ItemState
  reason?: string | null
  planned_publish_at?: string | null
  publish_tries?: number | null
  publish_at?: string | null
  youtube_video_id?: string | null
  video_id?: string | null
  asin?: string | null
  amazon?: Array<{ domain: string; state: string; detail: string | null }>
}

const when = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

/** Each place this video was sent, and where it actually is. Pure. */
export function placeLines(it: DropItemRow, li: LaunchItemView | null, opts: { dropState: string; sendToYouTube?: boolean; now?: number }): PlaceLine[] {
  const out: PlaceLine[] = []
  const stale = isStale(it.updated_at, opts.now)
  if (it.to_liftoff) {
    if (!li) {
      out.push({ place: 'YouTube', tone: opts.dropState === 'failed' ? 'bad' : opts.dropState === 'building' ? 'busy' : 'warn',
        text: opts.dropState === 'building' ? 'Being added to Liftoff' : 'Not in Liftoff: it was not added' })
    } else {
      if (opts.sendToYouTube !== false && li.state === 'prepared' && !li.planned_publish_at) {
        // PREPARED IS NOT ON YOUTUBE. Liftoff's own word for it ("Ready to
        // launch") is green there, where it asks for a press; here the drop
        // presses it, so it is still on the way.
        out.push(opts.dropState === 'needs_you'
          ? { place: 'YouTube', tone: 'warn', text: 'Prepared. It launches once Liftoff has what it needs (above).' }
          : { place: 'YouTube', tone: 'busy', text: 'Prepared, launching next' })
      } else if (opts.sendToYouTube !== false) {
        const label = itemProgressLabel(li)
        const tone = li.state === 'blocked' ? 'bad' : itemProgressTone(li)
        const at = li.state === 'scheduled' ? ` for ${when(li.publish_at)}` : ''
        out.push({ place: 'YouTube', tone, text: `${label}${at}${li.state === 'blocked' && li.reason ? `: ${li.reason}` : ''}` })
      }
      const us = (li.amazon ?? []).find((a) => a.domain === 'amazon.com') ?? (li.amazon ?? [])[0]
      if (!us) out.push({ place: 'Amazon', tone: 'idle', text: opts.sendToYouTube === false ? 'Waiting for Liftoff' : 'Starts once YouTube has it' })
      else if (us.state === 'delivered') out.push({ place: 'Amazon', tone: 'good', text: 'On Amazon' })
      else if (us.state === 'failed') out.push({ place: 'Amazon', tone: 'bad', text: `Not uploaded${us.detail ? `: ${us.detail}` : ''}` })
      else if (us.state.startsWith('grid:')) out.push({ place: 'Amazon', tone: 'warn', text: us.detail || 'Amazon has not taken it yet' })
      else out.push({ place: 'Amazon', tone: 'busy', text: 'Waiting for SCOUT to upload it' })
    }
  }
  if (it.to_blog) {
    const b = it.blog_state
    out.push(b === 'scheduled' ? { place: 'Blog', tone: 'good', text: `Scheduled${it.blog_at ? ` for ${when(it.blog_at)}` : ''}` }
      : b === 'writing' ? (stale ? { place: 'Blog', tone: 'warn', text: 'Stopped while it was being written. Check your blog for it before writing it again.' } : { place: 'Blog', tone: 'busy', text: 'Being written' })
        : b === 'failed' ? { place: 'Blog', tone: 'bad', text: `Not scheduled${it.blog_detail ? `: ${it.blog_detail}` : ''}` }
          : { place: 'Blog', tone: 'idle', text: 'Written once YouTube has the video and its time' })
  }
  if (it.to_trybe) {
    const s = it.trybe_state
    const brand = it.trybe_brand_name || 'the brand'
    out.push(s === 'in_review' ? { place: 'TRYBE', tone: 'good', text: `In ${brand}'s review on TRYBE` }
      : s === 'sent_unconfirmed' ? { place: 'TRYBE', tone: 'warn', text: `TRYBE took it, but it is not in your ${brand} submissions yet. Check TRYBE before sending again.` }
        : s === 'sending' ? (stale ? { place: 'TRYBE', tone: 'warn', text: `Stopped while sending to ${brand}. Check your TRYBE submissions before sending again.` } : { place: 'TRYBE', tone: 'busy', text: it.trybe_detail || `Sending to ${brand}` })
          : s === 'failed' ? { place: 'TRYBE', tone: 'bad', text: `Not sent${it.trybe_detail ? `: ${it.trybe_detail}` : ''}` }
            : { place: 'TRYBE', tone: 'idle', text: `Ready to send to ${brand}` })
  }
  if (!it.to_liftoff && !it.to_blog && !it.to_trybe) out.push({ place: it.kind === 'vertical' ? 'TRYBE' : 'YouTube', tone: 'idle', text: 'Not sent anywhere: no place was ticked' })
  return out
}

/** The drop's one line at the top of its card, counted from the same lines
 *  the card shows, so the two cannot disagree. Pure. */
export function dropHeadline(drop: { state: string; note: string | null }, lines: PlaceLine[][]): { tone: Tone; text: string } {
  const all = lines.flat()
  const bad = all.filter((l) => l.tone === 'bad').length
  const moving = all.filter((l) => l.tone === 'busy' || l.tone === 'idle').length
  const good = all.filter((l) => l.tone === 'good').length
  if (drop.state === 'failed') return { tone: 'bad', text: drop.note || 'This drop stopped.' }
  if (drop.state === 'needs_you') return { tone: 'warn', text: drop.note || 'Liftoff needs a choice from you.' }
  if (drop.state === 'building') return { tone: 'busy', text: 'Building the Liftoff batch' }
  if (drop.state === 'preparing') return { tone: 'busy', text: 'Liftoff is preparing the videos. It launches on its own when they are ready.' }
  if (bad) return { tone: 'bad', text: `${bad} ${bad === 1 ? 'place' : 'places'} did not take a video. Each one says why below.` }
  if (moving) return { tone: 'busy', text: `${good} done, ${moving} still on the way` }
  return { tone: 'good', text: 'Everything went where you sent it' }
}
