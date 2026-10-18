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

// ── Every place a dropped video can go ───────────────────────────────────────
//
// liftoff, blog and trybe have their own columns on drop_items (migration
// 436). The rest are one drop_sends row each (migration 437), run by
// lib/drop-places once the place can take the video.

export type ExtraPlace = 'tiktok' | 'instagram' | 'shorts' | 'facebook' | 'pinterest' | 'amazon' | 'pin' | 'group' | 'clips'
export type PlaceId = 'liftoff' | 'blog' | 'trybe' | ExtraPlace

export const EXTRA_PLACES: ExtraPlace[] = ['tiktok', 'instagram', 'shorts', 'facebook', 'pinterest', 'amazon', 'pin', 'group', 'clips']

export interface PlaceInfo {
  label: string
  /** The kind of video it takes. */
  kind: DropKind
  /** It works from the YouTube video, so it waits for Liftoff. */
  afterYouTube: boolean
  /** In plain words, what the creator gets. */
  says: string
  /** It goes out with the blog post (as one of its socials), so it needs it. */
  withBlog?: boolean
}

export const PLACE_INFO: Record<PlaceId, PlaceInfo> = {
  liftoff: { label: 'YouTube and Amazon', kind: 'long', afterYouTube: false, says: 'Liftoff, with your setup' },
  blog: { label: 'Blog post', kind: 'long', afterYouTube: true, says: 'Live ten minutes after the video' },
  pin: { label: 'Pinterest pin', kind: 'long', afterYouTube: true, withBlog: true, says: 'Pinned when the blog post goes live' },
  group: { label: 'Facebook post', kind: 'long', afterYouTube: true, withBlog: true, says: 'With the blog post. Waits in Meta Hub for your Group when one is saved' },
  clips: { label: '3 clips', kind: 'long', afterYouTube: true, says: 'Clip Factory finds 3 moments and makes them, up to 10 minute videos' },
  tiktok: { label: 'TikTok', kind: 'vertical', afterYouTube: false, says: 'Posted to your TikTok' },
  instagram: { label: 'Instagram Reel', kind: 'vertical', afterYouTube: false, says: 'Posted as a Reel' },
  shorts: { label: 'YouTube Short', kind: 'vertical', afterYouTube: false, says: 'Posted as a Short with your link' },
  facebook: { label: 'Facebook Reel', kind: 'vertical', afterYouTube: false, says: 'Posted as a Reel on your Page' },
  pinterest: { label: 'Pinterest video', kind: 'vertical', afterYouTube: false, says: 'A video pin' },
  amazon: { label: 'Amazon', kind: 'vertical', afterYouTube: false, says: 'Your US storefront, through SCOUT. Needs the product' },
  trybe: { label: 'TRYBE brand', kind: 'vertical', afterYouTube: false, says: 'Sent to the brand you pick, through SCOUT' },
}

/** The places this version of Drop can actually send to. The others are
 *  shown as coming, never as a choice that would sit unsent. */
export const READY_PLACES = new Set<PlaceId>(['liftoff', 'blog', 'trybe', 'tiktok', 'instagram', 'shorts', 'facebook', 'pinterest', 'amazon', 'pin', 'group', 'clips'])

/** Can this place take this video. The places that work from the YouTube
 *  video need it to go through Liftoff. Pure. */
export function placeFits(place: string, kind: DropKind, toLiftoff: boolean, toBlog = true): boolean {
  const info = PLACE_INFO[place as PlaceId]
  if (!info || info.kind !== kind) return false
  if (info.withBlog && !toBlog) return false
  return !info.afterYouTube || toLiftoff
}

/** A Launch plan: where each kind of video goes unless the creator says
 *  otherwise on the day, and (once set up) every YouTube and Amazon setting. */
export interface LaunchPlans { long: PlaceId[]; vertical: PlaceId[]; settings?: DropSettings | null }

/** EVERY LIFTOFF SETTING, SET ONCE ON THE DROP PAGE (Seb, 2026-10-17: "set
 *  up their settings and their plan on one page. And then once that setup is
 *  done, they never have to look at it again"). Each drop's Liftoff batch is
 *  made with these, through Liftoff's own checks. */
export interface DropSettings {
  sendToYouTube: boolean
  ctaChosen: boolean
  cta: unknown | null
  thumbnailChosen: boolean
  thumbnail: unknown | null
  dailySlots: string[]
  /** The channel (UC...) to upload to, confirmed with YouTube for each drop. */
  channelId: string | null
  playlistId: string | null
  notifySubscribers: boolean
  studioOptions: { disclosures: boolean; monetize: boolean; adRating: boolean; endScreen: boolean }
  /** The US Amazon store, or none. */
  amazon: boolean
  /** The days a video may go public, 0 Sunday to 6 Saturday. All seven
   *  unless the creator picked fewer. */
  days: number[]
  /** No video goes public before this day (YYYY-MM-DD), or null. */
  notBefore: string | null
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const cleanDays = (raw: unknown): number[] => {
  const list = Array.isArray(raw) ? [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []
  return list.length ? list : ALL_DAYS
}
const cleanDate = (raw: unknown): string | null => (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null)

/** The days in words: "every day", "weekdays", "Mon, Wed and Fri". Pure. */
export function daysLabel(days: number[] | null | undefined): string {
  const d = cleanDays(days)
  if (d.length === 7) return 'every day'
  if (d.join() === '1,2,3,4,5') return 'weekdays'
  if (d.join() === '0,6') return 'weekends'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const w = [...d.filter((x) => x !== 0), ...d.filter((x) => x === 0)].map((x) => names[x])
  return w.length === 1 ? `${w[0]} only` : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`
}

/** What the long videos' Liftoff place is called for this setup. Pure. */
export function liftoffLabel(st: Pick<DropSettings, 'sendToYouTube' | 'amazon'>): string | undefined {
  if (!st.sendToYouTube) return 'Amazon'
  if (!st.amazon) return 'YouTube'
  return undefined
}

const STUDIO_DEFAULT = { disclosures: true, monetize: true, adRating: true, endScreen: true }

/** The setup a creator starts from: their last launched batch, or blank. Pure. */
export function settingsFromLast(last: LastBatch | null): DropSettings {
  const so = (last?.studio_options && typeof last.studio_options === 'object' ? last.studio_options : {}) as Record<string, unknown>
  return {
    sendToYouTube: last?.send_to_youtube !== false,
    ctaChosen: !!last?.cta_chosen, cta: last?.cta_chosen ? (last.cta ?? null) : null,
    thumbnailChosen: !!last?.thumbnail_chosen, thumbnail: last?.thumbnail_chosen ? (last.thumbnail ?? null) : null,
    dailySlots: normalizeSlots(last?.daily_slots).length ? normalizeSlots(last?.daily_slots) : ['09:00'],
    channelId: last?.youtube_channel_id ?? null,
    playlistId: last?.playlist_id ?? null,
    notifySubscribers: last?.notify_subscribers === true,
    studioOptions: { ...STUDIO_DEFAULT, ...Object.fromEntries(Object.entries(so).filter(([k, v]) => k in STUDIO_DEFAULT && typeof v === 'boolean')) },
    amazon: (last?.markets ?? ['amazon.com']).includes('amazon.com'),
    days: ALL_DAYS,
    notBefore: null,
  }
}

/** A saved setup, cleaned, or null when none was saved. Pure. */
export function readSettings(raw: unknown): DropSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const so = (o.studioOptions && typeof o.studioOptions === 'object' ? o.studioOptions : {}) as Record<string, unknown>
  return {
    sendToYouTube: o.sendToYouTube !== false,
    ctaChosen: o.ctaChosen === true, cta: o.ctaChosen === true ? (o.cta ?? null) : null,
    thumbnailChosen: o.thumbnailChosen === true, thumbnail: o.thumbnailChosen === true ? (o.thumbnail ?? null) : null,
    dailySlots: normalizeSlots(Array.isArray(o.dailySlots) ? (o.dailySlots as string[]) : []),
    channelId: typeof o.channelId === 'string' && o.channelId ? o.channelId : null,
    playlistId: typeof o.playlistId === 'string' && o.playlistId ? o.playlistId : null,
    notifySubscribers: o.notifySubscribers === true,
    studioOptions: { ...STUDIO_DEFAULT, ...Object.fromEntries(Object.entries(so).filter(([k, v]) => k in STUDIO_DEFAULT && typeof v === 'boolean')) },
    amazon: o.amazon !== false,
    days: cleanDays(o.days),
    notBefore: cleanDate(o.notBefore),
  }
}

/** The PATCH for a drop's Liftoff batch from the setup, through Liftoff's
 *  own checks. A choice the setup never made stays open. Pure. */
export function settingsBody(st: DropSettings, timezone: string, startOn: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    timezone, startOn, sendToYouTube: st.sendToYouTube, markets: st.amazon ? ['amazon.com'] : [],
    notifySubscribers: st.notifySubscribers, playlistId: st.playlistId, studioOptions: st.studioOptions,
  }
  if (st.ctaChosen) { body.ctaChosen = true; body.cta = st.cta ?? null }
  if (st.thumbnailChosen) { body.thumbnailChosen = true; body.thumbnail = st.thumbnail ?? null }
  if (st.dailySlots.length) body.dailySlots = st.dailySlots
  return body
}

/** The first day of a drop's batch: the first day a time is still ahead,
 *  or the creator's not-before day if that is later. Pure. */
export function setupStartOn(st: Pick<DropSettings, 'dailySlots' | 'notBefore'>, timezone: string, now: Date = new Date()): string {
  const first = firstDay(st.dailySlots, timezone, now).startOn
  return st.notBefore && st.notBefore > first ? st.notBefore : first
}

/** What the setup still needs before a long video can go, in words. Pure. */
export function setupMissing(st: DropSettings | null): string[] {
  if (!st) return ['your setup']
  const out: string[] = []
  if (!st.ctaChosen) out.push('your CTA')
  if (!st.thumbnailChosen) out.push('your thumbnail look')
  if (st.sendToYouTube && !st.dailySlots.length) out.push('your posting times')
  if (st.sendToYouTube && !st.channelId) out.push('your YouTube channel')
  if (!st.sendToYouTube && !st.amazon) out.push('somewhere to send it (YouTube or Amazon)')
  return out
}
export const DEFAULT_PLANS: LaunchPlans = { long: ['liftoff', 'blog'], vertical: ['trybe'] }

/** A saved plan, cleaned: only places that exist and fit their kind. Pure. */
export function readPlans(raw: unknown): LaunchPlans {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const pick = (kind: DropKind): PlaceId[] => {
    const list = Array.isArray(o[kind]) ? (o[kind] as unknown[]).map(String) : null
    if (!list) return DEFAULT_PLANS[kind]
    return [...new Set(list)].filter((p): p is PlaceId => !!PLACE_INFO[p as PlaceId] && PLACE_INFO[p as PlaceId].kind === kind)
  }
  return { long: pick('long'), vertical: pick('vertical'), settings: readSettings(o.settings) }
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

/**
 * THE NEXT FREE TIMES ON YOUR PATTERN, one per video: each a slot from the
 * setup's times, at least `leadMinutes` ahead, not one a video of yours is
 * already going public at. Dropping two videos on Tuesday after three on
 * Monday follows on from Monday's, instead of putting two on the same
 * morning. Each becomes that video's own time in Liftoff, shown and editable
 * on its card. Pure.
 */
export function nextFreeSlots(n: number, slots: string[] | null | undefined, timezone: string, taken: number[],
  now: Date = new Date(), leadMinutes = 90, only: { days?: number[] | null; notBefore?: string | null } = {}): Array<{ date: string; time: string; at: number }> {
  const days = cleanDays(only.days)
  const notBefore = cleanDate(only.notBefore)
  const s = normalizeSlots(slots)
  const out: Array<{ date: string; time: string; at: number }> = []
  if (!s.length || n <= 0) return out
  const [y, mo, d] = todayIn(timezone, now).split('-').map(Number)
  for (let day = 0; day < 400 && out.length < n; day++) {
    const dt = new Date(Date.UTC(y, mo - 1, d + day))
    const yy = dt.getUTCFullYear(), mm = dt.getUTCMonth() + 1, dd = dt.getUTCDate()
    const date = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    // Only the creator's days, and nothing before their first day.
    if (!days.includes(dt.getUTCDay()) || (notBefore && date < notBefore)) continue
    for (const slot of s) {
      const m = parseSlot(slot)
      if (m == null) continue
      const at = zonedTimeToInstant(yy, mm, dd, m, timezone).getTime()
      if (at - now.getTime() < leadMinutes * 60_000) continue
      if (taken.some((t) => Math.abs(t - at) < 60_000) || out.some((o) => o.at === at)) continue
      out.push({ date, time: slot, at })
      if (out.length >= n) break
    }
  }
  return out
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
export interface PlaceLine {
  /** What the line is about, in words: YouTube, Amazon, Blog, TRYBE, TikTok... */
  place: string
  /** Which place's icon: a PlaceId, or amazon (Liftoff's second half). */
  id: PlaceId | 'amazon'
  tone: Tone
  text: string
  /** Where the result is, when there is one to open. */
  url?: string | null
}

/** One other place for one video, as drop_sends has it (migration 437). */
export interface SendRow { id: string; place: string; state: string; detail: string | null; url: string | null; updated_at?: string | null }

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
  /** The other places (migration 437). */
  sends?: SendRow[]
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
      out.push({ place: 'YouTube', id: 'liftoff', tone: opts.dropState === 'failed' ? 'bad' : opts.dropState === 'building' ? 'busy' : 'warn',
        text: opts.dropState === 'building' ? 'Being added to Liftoff' : 'Not in Liftoff: it was not added' })
    } else {
      if (opts.sendToYouTube !== false && li.state === 'prepared' && !li.planned_publish_at) {
        // PREPARED IS NOT ON YOUTUBE. Liftoff's own word for it ("Ready to
        // launch") is green there, where it asks for a press; here the drop
        // presses it, so it is still on the way.
        out.push(opts.dropState === 'needs_you'
          ? { place: 'YouTube', id: 'liftoff', tone: 'warn', text: 'Prepared. It launches once Liftoff has what it needs (above).' }
          : { place: 'YouTube', id: 'liftoff', tone: 'busy', text: 'Prepared, launching next' })
      } else if (opts.sendToYouTube !== false) {
        const label = itemProgressLabel(li)
        const tone = li.state === 'blocked' ? 'bad' : itemProgressTone(li)
        const at = li.state === 'scheduled' ? ` for ${when(li.publish_at)}` : ''
        out.push({ place: 'YouTube', id: 'liftoff', tone, text: `${label}${at}${li.state === 'blocked' && li.reason ? `: ${li.reason}` : ''}` })
      }
      const us = (li.amazon ?? []).find((a) => a.domain === 'amazon.com') ?? (li.amazon ?? [])[0]
      if (!us) out.push({ place: 'Amazon', id: 'amazon', tone: 'idle', text: opts.sendToYouTube === false ? 'Waiting for Liftoff' : 'Starts once YouTube has it' })
      else if (us.state === 'delivered') out.push({ place: 'Amazon', id: 'amazon', tone: 'good', text: 'On Amazon' })
      else if (us.state === 'failed') out.push({ place: 'Amazon', id: 'amazon', tone: 'bad', text: `Not uploaded${us.detail ? `: ${us.detail}` : ''}` })
      else if (us.state.startsWith('grid:')) out.push({ place: 'Amazon', id: 'amazon', tone: 'warn', text: us.detail || 'Amazon has not taken it yet' })
      else out.push({ place: 'Amazon', id: 'amazon', tone: 'busy', text: 'Waiting for SCOUT to upload it' })
    }
  }
  if (it.to_blog) {
    const b = it.blog_state
    out.push(b === 'scheduled' ? { place: 'Blog', id: 'blog', tone: 'good', text: `Scheduled${it.blog_at ? ` for ${when(it.blog_at)}` : ''}`, url: it.blog_url }
      : b === 'writing' ? (stale ? { place: 'Blog', id: 'blog', tone: 'warn', text: 'Stopped while it was being written. Check your blog for it before writing it again.' } : { place: 'Blog', id: 'blog', tone: 'busy', text: 'Being written' })
        : b === 'failed' ? { place: 'Blog', id: 'blog', tone: 'bad', text: `Not scheduled${it.blog_detail ? `: ${it.blog_detail}` : ''}` }
          : { place: 'Blog', id: 'blog', tone: 'idle', text: 'Written once YouTube has the video and its time' })
  }
  if (it.to_trybe) {
    const s = it.trybe_state
    const brand = it.trybe_brand_name || 'the brand'
    out.push(s === 'in_review' ? { place: 'TRYBE', id: 'trybe', tone: 'good', text: `In ${brand}'s review on TRYBE` }
      : s === 'sent_unconfirmed' ? { place: 'TRYBE', id: 'trybe', tone: 'warn', text: `TRYBE took it, but it is not in your ${brand} submissions yet. Check TRYBE before sending again.` }
        : s === 'sending' ? (stale ? { place: 'TRYBE', id: 'trybe', tone: 'warn', text: `Stopped while sending to ${brand}. Check your TRYBE submissions before sending again.` } : { place: 'TRYBE', id: 'trybe', tone: 'busy', text: it.trybe_detail || `Sending to ${brand}` })
          : s === 'failed' ? { place: 'TRYBE', id: 'trybe', tone: 'bad', text: `Not sent${it.trybe_detail ? `: ${it.trybe_detail}` : ''}` }
            : { place: 'TRYBE', id: 'trybe', tone: 'idle', text: `Ready to send to ${brand}` })
  }
  for (const x of it.sends ?? []) {
    const info = PLACE_INFO[x.place as PlaceId]
    if (!info) continue
    const id = x.place as PlaceId
    const sStale = isStale(x.updated_at, opts.now)
    out.push(x.state === 'done' ? { place: info.label, id, tone: 'good', text: x.detail || 'Done', url: x.url }
      : x.state === 'failed' ? { place: info.label, id, tone: 'bad', text: `Not done${x.detail ? `: ${x.detail}` : ''}` }
        : x.state === 'needs_you' ? { place: info.label, id, tone: 'warn', text: x.detail || 'Needs a choice from you', url: x.url }
          : x.state === 'sending' ? (sStale ? { place: info.label, id, tone: 'warn', text: 'Stopped part way. Check it before trying again.' } : { place: info.label, id, tone: 'busy', text: x.detail || 'On its way' })
            : { place: info.label, id, tone: 'idle', text: info.afterYouTube ? 'Starts once YouTube has the video' : 'Waiting its turn' })
  }
  if (!it.to_liftoff && !it.to_blog && !it.to_trybe && !(it.sends ?? []).length) out.push({ place: it.kind === 'vertical' ? 'TRYBE' : 'YouTube', id: it.kind === 'vertical' ? 'trybe' : 'liftoff', tone: 'idle', text: 'Not sent anywhere: no place was picked' })
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
