// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE ONE YOUTUBE QUOTA EVERY ACCOUNT SHARES.
//
// MVP's YouTube Data API project has a fixed number of units a day for all
// creators together (YOUTUBE_DAILY_QUOTA, 10,000 by default), reset at
// midnight Pacific. One day it ran out by evening: a day of blog posts
// downloading captions at 250 units each took it, and then playlists, uploads
// and comments failed for everybody, with no record of who or what spent it.
//
// Every YouTube call MVP makes now goes through ytFetch, which:
//   - RECORDS IT (migration 397): Pacific day, the account whose token made it,
//     the API method and its cost. Admin > Costs shows the day by method and
//     by account. A missing table only loses the record, never the call.
//   - STOPS ASKING ONCE YOUTUBE SAYS NO. After a quota refusal every call is
//     answered here with the same refusal, without a request, until a probe
//     20 minutes later (in case the limit was raised) or the reset.
//   - KEEPS ROOM FOR WHAT MATTERS. Caption downloads and searches are the
//     calls MVP can do without (the audio gives the words; search has cheaper
//     paths), so once the day passes RESERVE_AT of the quota they are refused
//     here, leaving the rest for uploads, comments and Studio settings.
//
// A refusal made here looks exactly like YouTube's own (status 403, reason
// quotaExceeded), so every caller's existing quota handling applies, and its
// message says it was MVP holding back, not YouTube, so the two are not
// confused when read.

import { fetchWithTimeout, type TimeoutInit } from '@/lib/fetch-timeout'

export const DAILY_QUOTA = Math.max(1000, Number(process.env.YOUTUBE_DAILY_QUOTA) || 10_000)
/** Share of the day after which optional calls are held back. */
export const RESERVE_AT = 0.6
/** How long to wait after a refusal before letting one call through to see. */
export const PROBE_AFTER_MS = 20 * 60_000

/** The quota day: the date in California, where YouTube resets it. */
export function quotaDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Milliseconds until the next midnight Pacific. */
export function msToReset(now: Date = new Date()): number {
  // The Pacific clock time now, read as if it were UTC, gives the offset.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value]))
  const h = Number(parts.hour) % 24, m = Number(parts.minute), s = Number(parts.second)
  return Math.max(1000, ((24 - h) * 3600 - m * 60 - s) * 1000 - now.getMilliseconds())
}

export type YtCall = { method: string; units: number; optional: boolean }

/**
 * What a request to YouTube is and costs, or null when it is not a quota call
 * (sign-in, token refresh, the public watch pages, upload pieces after the
 * first). Costs are YouTube's published ones. Pure.
 */
export function ytCallOf(url: string, httpMethod: string = 'GET'): YtCall | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.hostname !== 'www.googleapis.com' && u.hostname !== 'youtube.googleapis.com') return null
  const m = httpMethod.toUpperCase()
  const path = u.pathname
  // Uploads: the first request (multipart, or opening a resumable session)
  // costs 1,600; the pieces sent to the session after it cost nothing.
  if (path.startsWith('/upload/youtube/v3/')) {
    const what = path.slice('/upload/youtube/v3/'.length).split('/')[0] || 'upload'
    if (m === 'POST') return { method: `${what}.insert`, units: what === 'videos' ? 1600 : 50, optional: false }
    return null
  }
  if (!path.startsWith('/youtube/v3/')) return null
  const parts = path.slice('/youtube/v3/'.length).split('/').filter(Boolean)
  const res = parts[0] || 'unknown'
  if (res === 'search') return { method: 'search.list', units: 100, optional: true }
  if (res === 'captions') {
    if (parts[1] && m === 'GET') return { method: 'captions.download', units: 200, optional: true }
    if (m === 'GET') return { method: 'captions.list', units: 50, optional: true }
    return { method: `captions.${m === 'POST' ? 'insert' : m === 'DELETE' ? 'delete' : 'update'}`, units: m === 'POST' ? 400 : 450, optional: false }
  }
  if (res === 'thumbnails') return { method: 'thumbnails.set', units: 50, optional: false }
  if (m === 'GET') return { method: `${res}.list`, units: 1, optional: false }
  const verb = parts[1] ? parts[1] : m === 'POST' ? 'insert' : m === 'PUT' ? 'update' : m === 'DELETE' ? 'delete' : m.toLowerCase()
  return { method: `${res}.${verb}`, units: 50, optional: false }
}

// ── Whose token is this ─────────────────────────────────────────────────────
// Tokens are handed out by getChannelOAuthToken / getValidYouTubeToken, which
// know the account; they note it here so a call can be put down to someone
// without every caller passing it along. Kept small: one serverless instance.
const owners = new Map<string, string>()
export function noteTokenOwner(token: string | null | undefined, userId: string | null | undefined): void {
  if (!token || !userId) return
  if (owners.size > 500) owners.delete(owners.keys().next().value as string)
  owners.set(token, userId)
}
function bearerOf(headers: HeadersInit | undefined): string | null {
  if (!headers) return null
  let v: string | null = null
  if (headers instanceof Headers) v = headers.get('authorization')
  else if (Array.isArray(headers)) v = (headers.find(([k]) => k.toLowerCase() === 'authorization') ?? [])[1] ?? null
  else v = (headers as Record<string, string>).Authorization ?? (headers as Record<string, string>).authorization ?? null
  const m = /^Bearer\s+(.+)$/i.exec(String(v || ''))
  return m ? m[1] : null
}

// ── The day's state, shared through the log ─────────────────────────────────
type State = { day: string; spent: number; refusedAt: number | null; readAt: number }
let state: State | null = null
const READ_EVERY_MS = 60_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function admin(): Promise<any | null> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    return createAdminClient()
  } catch { return null }
}

// ONE READ AT A TIME, AND NEVER LONG. This sits in front of every YouTube
// call, uploads included, so a slow database must not slow YouTube: a read
// that takes over 1.5 seconds is not waited for, and the call goes ahead on
// what this instance already knows.
let inflight: Promise<State> | null = null
async function readState(): Promise<State> {
  const day = quotaDay()
  if (state && state.day === day && Date.now() - state.readAt < READ_EVERY_MS) return state
  if (!inflight) inflight = readStateNow().finally(() => { inflight = null })
  const known: State = state && state.day === day ? state : { day, spent: 0, refusedAt: null, readAt: 0 }
  return Promise.race([inflight, new Promise<State>((r) => setTimeout(() => r(known), 1500))])
}

async function readStateNow(): Promise<State> {
  const day = quotaDay()
  const next: State = { day, spent: state?.day === day ? state.spent : 0, refusedAt: state?.day === day ? state.refusedAt : null, readAt: Date.now() }
  const sb = await admin()
  if (sb) {
    try {
      const [{ data: spent }, { data: refused }] = await Promise.all([
        sb.rpc('youtube_quota_spent', { p_day: day }),
        sb.from('youtube_quota_log').select('at').eq('day', day).eq('method', 'quota_refused').order('at', { ascending: false }).limit(1),
      ])
      if (typeof spent === 'number' || typeof spent === 'string') next.spent = Math.max(next.spent, Number(spent) || 0)
      const at = Array.isArray(refused) && refused[0]?.at ? Date.parse(refused[0].at) : null
      if (at && (!next.refusedAt || at > next.refusedAt)) next.refusedAt = at
    } catch { /* no table yet: this instance's own count is all there is */ }
  }
  state = next
  return next
}

function record(day: string, userId: string | null, method: string, units: number, ok: boolean): void {
  if (state && state.day === day) state.spent += units
  void (async () => {
    const sb = await admin()
    if (!sb) return
    try { await sb.from('youtube_quota_log').insert({ day, user_id: userId, method, units, ok }) } catch { /* the call still happened */ }
  })()
}

/** Is YouTube refusing right now, and until when (for messages). Pure on a state. */
export function holdOf(s: Pick<State, 'spent' | 'refusedAt'>, call: YtCall, now: number, quota = DAILY_QUOTA): { hold: false } | { hold: true; why: 'refused' | 'reserved' } {
  if (s.refusedAt && now - s.refusedAt < PROBE_AFTER_MS) return { hold: true, why: 'refused' }
  if (call.optional && s.spent + call.units > quota * RESERVE_AT) return { hold: true, why: 'reserved' }
  return { hold: false }
}

function refusal(why: 'refused' | 'reserved'): Response {
  const message = why === 'refused'
    ? 'MVP paused YouTube calls: YouTube said the daily quota is used up (exceeded your quota). It resets at midnight Pacific time.'
    : 'MVP is keeping the rest of today’s YouTube quota for uploads, comments and Studio settings (exceeded your quota share for searches and caption downloads). It resets at midnight Pacific time.'
  return new Response(JSON.stringify({ error: { code: 403, message, errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota', message }] } }), {
    status: 403, headers: { 'content-type': 'application/json', 'x-mvp-quota-hold': why },
  })
}

export function isQuotaRefusalBody(text: string): boolean {
  return /"reason"\s*:\s*"(?:quotaExceeded|dailyLimitExceeded)"/.test(text)
}

// A THROWN QUOTA REFUSAL IS NOT AN ANSWER. services/youtube throws the text
// youTubeErrorText builds, which always carries "quotaExceeded" for the shared
// allowance (YouTube's refusal or MVP's hold). Callers ask this before reading
// a failure as "deleted", "private", "wrong channel" or "not found".
export function isQuotaError(e: unknown): boolean {
  return /quotaExceeded|dailyLimitExceeded/.test(e instanceof Error ? e.message : String(e ?? ''))
}

/** The sentence a creator reads when YouTube could not be asked for quota. */
export const QUOTA_WAIT_TEXT = 'YouTube’s daily allowance is used up; MVP tries again after midnight Pacific.'

/** For crons: YouTube refused less than PROBE_AFTER_MS ago, so every call
 *  now would only be answered by the hold. Pure on quotaToday's answer. */
export function refusingNow(q: { refusedAt: string | null } | null | undefined, now: number = Date.now()): boolean {
  const at = q?.refusedAt ? Date.parse(q.refusedAt) : NaN
  return Number.isFinite(at) && now - at < PROBE_AFTER_MS
}

/**
 * fetch for YouTube. Same signature as fetchWithTimeout; anything that is not
 * a quota call passes straight through.
 */
export async function ytFetch(input: string | URL, init: TimeoutInit = {}): Promise<Response> {
  const url = String(input)
  const call = ytCallOf(url, init.method || 'GET')
  if (!call) return fetchWithTimeout(input, init)
  const s = await readState()
  const hold = holdOf(s, call, Date.now())
  const userId = owners.get(bearerOf(init.headers) || '') ?? null
  if (hold.hold) {
    record(s.day, userId, `held.${call.method}`, 0, false)
    return refusal(hold.why)
  }
  const res = await fetchWithTimeout(input, init)
  if (res.status === 403 || res.status === 429) {
    const text = await res.clone().text().catch(() => '')
    if (isQuotaRefusalBody(text)) {
      if (state && state.day === s.day) state.refusedAt = Date.now()
      record(s.day, userId, 'quota_refused', 0, false)
      return res
    }
  }
  // A refused request costs YouTube's minimum (1 unit), not the full price:
  // charging a refused upload 1,600 put the day past the reserve line within
  // minutes of a channel hitting its own upload limit.
  record(s.day, userId, call.method, res.ok ? call.units : res.status >= 500 ? 0 : 1, res.ok)
  return res
}

/** For Admin > Costs: the day so far. */
export async function quotaToday(): Promise<{ day: string; quota: number; reserveAt: number; spent: number; refusedAt: string | null; msToReset: number }> {
  // The admin panel waits for the real numbers.
  const s = await readStateNow()
  return { day: s.day, quota: DAILY_QUOTA, reserveAt: Math.round(DAILY_QUOTA * RESERVE_AT), spent: s.spent, refusedAt: s.refusedAt ? new Date(s.refusedAt).toISOString() : null, msToReset: msToReset() }
}
