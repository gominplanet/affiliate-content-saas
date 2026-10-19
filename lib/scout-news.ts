// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SCOUT NEWS POPUP (Seb, 2026-10-17: "an automatic pop up when users
// first open MVP Affiliate.. anytime there is a new scout update ... the
// latest, newest features ... a little bit of an overview ... and also a
// randomized YouTube video that they can watch right there on the card").
//
// WHAT IT SHOWS, AND WHEN. A card with the SCOUT version, a short line per new
// feature and the MVP Affiliate channel's three latest videos, the newest
// ready to play in the card (Seb, the same day: "let's have the latest three
// published videos to watch on that card"). Shorts are left out: a vertical
// video plays letterboxed in the card's wide frame. Once
// per release, per browser: "Got it" puts it away until the next release,
// "Later" until the next visit. Only releases listed in SCOUT_RELEASES pop up,
// so a small fix does not interrupt anyone; add a release here when it has
// something a member will notice.
//
// NEVER "UPDATE NOW" TO A STORE INSTALL. Chrome updates a Web Store SCOUT by
// itself, and only once the store has approved the new build, so there is
// nothing a member can click to get it sooner. A store install hears about a
// release once Chrome has delivered it, which is also the moment its features
// work. Only two cases get a button: no SCOUT at all (on a desktop browser
// that can run it) gets "Get SCOUT", and the old manually loaded copy, which
// never updates itself, is pointed at the Web Store.
//
// Each note can name the feature it belongs to (lib/labs-preview, or the
// video tools), and a member only sees notes for features their plan has.

import { scoutAtLeast } from '@/lib/scout-version'
import type { PreviewFeature } from '@/lib/labs-preview'

/** The MVP Affiliate YouTube channel (youtube.com/@MVPaffiliate). */
export const MVP_CHANNEL_ID = 'UCyxAkGx_IbKVCs0Uon9MAfA'
export const MVP_CHANNEL_URL = 'https://www.youtube.com/@MVPaffiliate/videos'
/** ?sub_confirmation=1 makes YouTube open its Subscribe prompt on arrival
 *  (Seb, 2026-10-17: "add a subscribe to the youtube channel and to the
 *  facebook group"). The group is lib/community's FACEBOOK_GROUP_URL. */
export const MVP_SUBSCRIBE_URL = 'https://www.youtube.com/@MVPaffiliate?sub_confirmation=1'

/** The browser's record of the newest release whose news it has shown. */
export const SEEN_KEY = 'mvp_scout_news_seen'
/** "Later": not again in this tab until the next visit. */
export const LATER_KEY = 'mvp_scout_news_later'
/** Add ?scoutnews to any MVP page to open the card again (testing). */
export const FORCE_PARAM = 'scoutnews'
/** At most this many lines on the card, newest first. */
export const MAX_NOTES = 5

export type NoteGate = PreviewFeature | 'video_tools'
export type ScoutNote = { text: string; href?: string; gate?: NoteGate }
export type ScoutRelease = { version: string; date: string; notes: ScoutNote[] }

/** Releases with news, newest first. A short line each (an overview, not a
 *  manual: at most 110 characters), plain words, no dashes. */
export const SCOUT_RELEASES: ScoutRelease[] = [
  {
    version: '1.53.1',
    date: '2026-10-19',
    notes: [
      { text: 'TRYBE: SCOUT stops asking to be allowed again once you have allowed it, and opens one Allow window at most.', href: '/trybe', gate: 'trybe_outreach' },
    ],
  },
  {
    version: '1.53.0',
    date: '2026-10-19',
    notes: [
      { text: 'Creator Connections: brand new campaigns now reach MVP within a day, before the weekly import.', href: '/cc-campaigns' },
    ],
  },
  {
    version: '1.52.3',
    date: '2026-10-19',
    notes: [
      { text: 'TRYBE: sends work out of sight again, and a brand SCOUT cannot reach says which page it saw.', href: '/trybe?tab=queue', gate: 'trybe_outreach' },
    ],
  },
  {
    version: '1.52.2',
    date: '2026-10-19',
    notes: [
      { text: 'Meta Hub: after you press Post in your Group, close the Facebook tab too. SCOUT finds the post itself.', href: '/meta', gate: 'facebook_reels' },
    ],
  },
  {
    version: '1.50.1',
    date: '2026-10-17',
    notes: [
      { text: 'TRYBE: no more windows popping up. SCOUT works out of sight and finds brands further down TRYBE\u2019s list.', href: '/trybe?tab=queue', gate: 'trybe_outreach' },
    ],
  },
  {
    version: '1.50.0',
    date: '2026-10-16',
    notes: [
      { text: 'Meta Hub: once your Group post is up, close MVP. SCOUT waits for Facebook, then the Page Reel posts itself.', href: '/meta', gate: 'facebook_reels' },
    ],
  },
  {
    version: '1.49.0',
    date: '2026-10-16',
    notes: [
      { text: 'Pulse: SCOUT reads Instagram\u2019s hashtag sizes, so MVP picks tags people can actually find.', href: '/pulse', gate: 'hashtag_trends' },
    ],
  },
  {
    version: '1.48.0',
    date: '2026-10-16',
    notes: [
      { text: 'TRYBE: Send all runs inside SCOUT. Close the tab and keep working.', href: '/trybe?tab=queue', gate: 'trybe_outreach' },
    ],
  },
  {
    version: '1.47.3',
    date: '2026-10-16',
    notes: [
      { text: 'Meta Hub: SCOUT finds your Group post\u2019s link in more of Facebook\u2019s layouts.', href: '/meta', gate: 'facebook_reels' },
    ],
  },
  {
    version: '1.47.0',
    date: '2026-10-14',
    notes: [
      { text: 'TRYBE: each brand shows its pay per video, how crowded it is, and your ads running.', href: '/trybe?tab=find', gate: 'trybe_outreach' },
    ],
  },
  {
    version: '1.46.1',
    date: '2026-10-12',
    notes: [
      { text: 'Bulk Amazon upload: a live count of which video each Amazon store is on.', href: '/liftoff', gate: 'video_tools' },
    ],
  },
]

/** The releases with only the notes this member's plan can use. Releases
 *  left with no notes are dropped. `can` is the plan check (server side). */
export function releasesFor(can: (gate: NoteGate) => boolean, releases: ScoutRelease[] = SCOUT_RELEASES): ScoutRelease[] {
  return releases
    .map((r) => ({ ...r, notes: r.notes.filter((n) => !n.gate || can(n.gate)) }))
    .filter((r) => r.notes.length > 0)
}

const newer = (a: string, b: string) => scoutAtLeast(a, b) && !scoutAtLeast(b, a)

export type InstallKind = 'store' | 'sideload' | 'none'
export type PopupMode = 'updated' | 'get' | 'move'
export type PopupPlan = {
  mode: PopupMode
  /** The version the card is about. */
  version: string
  notes: (ScoutNote & { version: string })[]
  /** What "Got it" records as seen. */
  seenTo: string
}

/**
 * Whether to show the card, and what it says. Pure.
 *
 *  - store install: the releases it HAS and has not seen. Nothing while
 *    Chrome has not delivered a new one yet.
 *  - old manual copy behind the newest release: point it at the Web Store.
 *  - no SCOUT: "Get SCOUT", only on a desktop browser that can run it.
 */
export function scoutPopupPlan(input: {
  kind: InstallKind
  installed: string | null
  seen: string | null
  later?: string | null
  desktop: boolean
  releases: ScoutRelease[]
  force?: boolean
}): PopupPlan | null {
  const releases = [...input.releases].filter((r) => r.notes.length > 0).sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0))
  if (!releases.length) return null
  const seen = input.force ? null : input.seen
  const unseen = (r: ScoutRelease) => !seen || newer(r.version, seen)
  const flat = (rs: ScoutRelease[]) => rs.flatMap((r) => r.notes.map((n) => ({ ...n, version: r.version }))).slice(0, MAX_NOTES)

  let plan: PopupPlan | null = null
  const top = releases[0]
  if (input.kind === 'none') {
    if (!input.desktop) return null
    const rs = releases.filter(unseen)
    if (rs.length) plan = { mode: 'get', version: top.version, notes: flat(rs), seenTo: top.version }
  } else if (!input.installed) {
    // SCOUT answered without a version: nothing honest to say about it.
    return null
  } else if (input.kind === 'sideload' && newer(top.version, input.installed)) {
    const rs = releases.filter(unseen)
    if (rs.length) plan = { mode: 'move', version: top.version, notes: flat(rs), seenTo: top.version }
  } else {
    const rs = releases.filter((r) => scoutAtLeast(input.installed, r.version) && unseen(r))
    if (rs.length) plan = { mode: 'updated', version: input.installed, notes: flat(rs), seenTo: rs[0].version }
  }
  if (!plan) return null
  if (!input.force && input.later && input.later === plan.seenTo) return null
  return plan
}

// ── The channel's videos ────────────────────────────────────────────────────

export type ChannelVideo = { id: string; title: string; published: string | null }

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '’').replace(/&apos;/g, '’')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')

/** The channel's public feed (youtube.com/feeds/videos.xml), Shorts left out:
 *  a Short's entry links to /shorts/<id>. Pure. */
export function parseChannelFeed(xml: string): ChannelVideo[] {
  const out: ChannelVideo[] = []
  for (const m of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]
    const id = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/.exec(e)?.[1]
    if (!id) continue
    const link = /<link rel="alternate" href="([^"]+)"/.exec(e)?.[1] || ''
    if (/\/shorts\//.test(link)) continue
    const title = unescapeXml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] || '').trim()
    out.push({ id, title, published: /<published>([^<]+)<\/published>/.exec(e)?.[1] || null })
  }
  return out
}

/** Seconds in an ISO 8601 duration (PT12M5S), or null. */
function isoSecs(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || ''))
  if (!m) return null
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)
}

/** From YouTube's videos.list answer: public, embeddable videos longer than a
 *  Short (3 minutes), not live right now and not a premiere still to come. A
 *  live stream's replay is a published video and stays. Pure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function watchableVideos(items: any[]): ChannelVideo[] {
  const out: ChannelVideo[] = []
  for (const v of items || []) {
    const id = typeof v?.id === 'string' ? v.id : null
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) continue
    if (v.status?.privacyStatus !== 'public' || v.status?.embeddable === false) continue
    if (v.snippet?.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none') continue
    const secs = isoSecs(v.contentDetails?.duration)
    if (secs === null || secs <= 180) continue
    out.push({ id, title: String(v.snippet?.title || '').trim(), published: v.snippet?.publishedAt || null })
  }
  return out
}

/** How many of the channel's videos the card offers. */
export const VIDEOS_ON_CARD = 3

/** The latest `n`, newest first; one with no date goes last. Pure. */
export function latestVideos(videos: ChannelVideo[], n = VIDEOS_ON_CARD): ChannelVideo[] {
  const t = (v: ChannelVideo) => (v.published ? Date.parse(v.published) || 0 : 0)
  return [...videos].sort((a, b) => t(b) - t(a)).slice(0, n)
}

/** The channel's uploads playlist: UC... becomes UU... */
export const uploadsPlaylist = (channelId: string) => 'UU' + channelId.slice(2)
