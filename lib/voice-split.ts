// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE RECORDING, EVERY PART (Seb, 2026-11-28: "When submitting voiceovers,
// could I send everything at once in one file where I just say all the hooks,
// all the bodies, and all the CTAs, and let MVP do the rest?").
//
// The recording is written down word by word (Whisper, each word with its
// time), and each hook, body and CTA of the set's scripts is found in it:
// the stretch of words that matches its script best. A line said twice (a
// retake) is taken from the last good take, the way creators re-read a line
// they fluffed. A set with no scripts is split where the creator says the
// part's name ("Hook one", "Body two", "CTA three"). A part not heard is
// named, never guessed. Pure, so it is tested (scripts/test-voice-split.ts).

import { bodyText, type ModularScripts } from './studio-scripts'

export type SplitKind = 'hook' | 'body' | 'cta'
export interface SplitPart { label: string; kind: SplitKind; tokens: string[] }
export interface HeardWord { start: number; end: number; text: string }
export interface FoundPart { label: string; kind: SplitKind; start: number; end: number; score: number; heard: string }
export interface SplitResult { found: FoundPart[]; missing: string[]; how: 'scripts' | 'labels' | 'none' }

/** A word as compared: lower case, letters and digits only. Pure. */
export const norm = (t: string) => String(t || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const tokensOf = (t: string) => norm(t).split(' ').filter(Boolean)

/** The parts to find, from the set's scripts. Pure. */
export function partsFromScripts(s: ModularScripts | null | undefined): SplitPart[] {
  if (!s) return []
  return [
    ...s.hooks.map((h) => ({ label: h.id, kind: 'hook' as const, tokens: tokensOf(h.say) })),
    ...s.bodies.map((b) => ({ label: b.id, kind: 'body' as const, tokens: tokensOf(bodyText(b)) })),
    ...s.ctas.map((c) => ({ label: c.id, kind: 'cta' as const, tokens: tokensOf(c.say) })),
  ].filter((p) => p.tokens.length >= 2)
}

/** The script's words found in order in the window (the longest such run),
 *  and where in the window the first and the last of them are. */
function align(p: string[], w: string[]): { m: number; first: number; last: number } {
  const n = p.length, k = w.length
  if (!n || !k) return { m: 0, first: -1, last: -1 }
  // Full table, so the matched words can be traced back exactly.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0))
  for (let i = 1; i <= n; i++) for (let j = 1; j <= k; j++) dp[i][j] = p[i - 1] === w[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const m = dp[n][k]
  if (!m) return { m: 0, first: -1, last: -1 }
  let i = n, j = k, first = -1, last = -1
  while (i > 0 && j > 0) {
    if (p[i - 1] === w[j - 1] && dp[i][j] === dp[i - 1][j - 1] + 1) { if (last < 0) last = j - 1; first = j - 1; i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return { m, first, last }
}

/** How well a part has to match to be taken: most of its words, in order. */
export const MATCH_MIN = 0.55

/** Each part found in the words: its best stretch, the last good take when
 *  it was said more than once. Parts that overlap give way to the better
 *  match. Pure. */
export function splitByScripts(words: HeardWord[], parts: SplitPart[], duration = Infinity): SplitResult {
  const T = words.map((w) => norm(w.text)).map((t) => t.split(' ')[0] || '')
  const found: FoundPart[] = []
  const missing: string[] = []
  for (const p of parts) {
    const L = p.tokens.length
    const span = Math.ceil(L * 1.4) + 3
    const heads = new Set(p.tokens.slice(0, Math.min(4, L)))
    let starts = T.map((t, i) => (heads.has(t) ? i : -1)).filter((i) => i >= 0)
    if (!starts.length) starts = T.map((_, i) => i).filter((i) => i % 3 === 0)
    const cands: Array<{ i0: number; i1: number; score: number }> = []
    for (const s of starts) {
      const w = T.slice(s, s + span)
      const a = align(p.tokens, w)
      if (a.m < 2) continue
      const score = a.m / L
      // The matched words close together, not scattered over the window.
      const dense = a.m / (a.last - a.first + 1)
      if (score >= MATCH_MIN && dense >= 0.5) cands.push({ i0: s + a.first, i1: s + a.last, score })
    }
    if (!cands.length) { missing.push(p.label); continue }
    // TAKES: matches that overlap are one take, kept at its best match (the
    // earliest start when equal). Then the last take nearly as good as the best.
    const takes: Array<{ i0: number; i1: number; score: number }> = []
    for (const c of [...cands].sort((a, b) => b.score - a.score || a.i0 - b.i0)) {
      if (takes.some((t) => c.i0 <= t.i1 && c.i1 >= t.i0)) continue
      takes.push(c)
    }
    const best = takes[0].score
    const pick = takes.filter((c) => c.score >= best - 0.08).sort((a, b) => b.i0 - a.i0)[0]
    found.push({ label: p.label, kind: p.kind, start: words[pick.i0].start, end: words[pick.i1].end, score: Math.round(pick.score * 100) / 100, heard: words.slice(pick.i0, Math.min(pick.i1 + 1, pick.i0 + 12)).map((w) => w.text).join(' ') })
  }
  return { found: settle(found, duration), missing, how: parts.length ? 'scripts' : 'none' }
}

const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, won: 1, to: 2, too: 2, for: 4 }

/** A set with no scripts: split where the creator says the part's name
 *  ("Hook one", "Body two", "CTA three", "Call to action one"). Pure. */
export function splitByLabels(words: HeardWord[], duration = Infinity): SplitResult {
  const T = words.map((w) => norm(w.text).split(' ')[0] || '')
  const marks: Array<{ at: number; next: number; kind: SplitKind; n: number }> = []
  for (let i = 0; i < T.length; i++) {
    let kind: SplitKind | null = null, len = 1
    if (T[i] === 'hook' || T[i] === 'hooks') kind = 'hook'
    else if (T[i] === 'body' || T[i] === 'bodies') kind = 'body'
    else if (T[i] === 'cta' || T[i] === 'ctas') kind = 'cta'
    else if (T[i] === 'call' && T[i + 1] === 'to' && T[i + 2] === 'action') { kind = 'cta'; len = 3 }
    else if (T[i] === 'c' && T[i + 1] === 't' && T[i + 2] === 'a') { kind = 'cta'; len = 3 }
    if (!kind) continue
    const n = NUMBER[T[i + len]]
    // Only a name with its number counts ("the body of the bag" is not a label).
    if (!n || (T[i + len] === 'to' || T[i + len] === 'too' || T[i + len] === 'for') && i + len + 1 < T.length && NUMBER[T[i + len + 1]]) continue
    marks.push({ at: i, next: i + len + 1, kind, n })
  }
  const found: FoundPart[] = []
  for (let m = 0; m < marks.length; m++) {
    const a = marks[m].next, b = (m + 1 < marks.length ? marks[m + 1].at : T.length) - 1
    if (b < a) continue
    const letter = marks[m].kind === 'hook' ? 'H' : marks[m].kind === 'body' ? 'B' : 'C'
    const label = `${letter}${marks[m].n}`
    // Said again later: the later one wins (a retake).
    const was = found.findIndex((f) => f.label === label)
    const part: FoundPart = { label, kind: marks[m].kind, start: words[a].start, end: words[b].end, score: 1, heard: words.slice(a, Math.min(b + 1, a + 12)).map((w) => w.text).join(' ') }
    if (was >= 0) found.splice(was, 1, part)
    else found.push(part)
  }
  return { found: settle(found, duration), missing: [], how: found.length ? 'labels' : 'none' }
}

/** Ordered by time, padded a little either side (a breath in, the last word's
 *  tail), never overlapping and never past the end. An overlap goes to the
 *  better match. Pure. */
export function settle(parts: FoundPart[], duration = Infinity): FoundPart[] {
  const s = [...parts].sort((a, b) => a.start - b.start)
  const kept: FoundPart[] = []
  for (const p of s) {
    const last = kept[kept.length - 1]
    if (last && p.start < last.end) {
      if (p.score > last.score) { kept.pop(); kept.push(p) }
      continue
    }
    kept.push(p)
  }
  return kept.map((p, i) => {
    const before = i > 0 ? kept[i - 1].end : 0
    const after = i + 1 < kept.length ? kept[i + 1].start : duration
    const r = (x: number) => Math.round(x * 100) / 100
    return { ...p, start: r(Math.max(before + (i > 0 ? 0.05 : 0), p.start - 0.12)), end: r(Math.min(after - 0.05, duration, p.end + 0.3)) }
  })
}

/** The recording split: by the set's scripts when it has them, by the part
 *  names said aloud when it has none (or when the names find more). Pure. */
export function splitVoice(words: HeardWord[], scripts: ModularScripts | null | undefined, duration = Infinity): SplitResult {
  const parts = partsFromScripts(scripts)
  const byScripts = parts.length ? splitByScripts(words, parts, duration) : null
  const byLabels = splitByLabels(words, duration)
  if (!byScripts) return byLabels
  return byLabels.found.length > byScripts.found.length ? { ...byLabels, missing: byScripts.missing.filter((m) => !byLabels.found.some((f) => f.label === m)) } : byScripts
}

/** What was found and what was not, in words for the page. Pure. */
export function splitWords(r: SplitResult): string {
  if (!r.found.length) return r.how === 'none'
    ? 'MVP could not tell the parts apart in this recording. Write the scripts first and read them as written, or say each part’s name before it ("Hook one", "Body two", "CTA one").'
    : 'MVP did not hear any of the scripts’ lines in this recording. Check that it is the recording of this set.'
  const count = (k: SplitKind, one: string, many: string) => { const n = r.found.filter((f) => f.kind === k).length; return n ? `${n} ${n === 1 ? one : many}` : '' }
  const got = [count('hook', 'hook', 'hooks'), count('body', 'body', 'bodies'), count('cta', 'CTA', 'CTAs')].filter(Boolean)
  const list = got.length > 1 ? `${got.slice(0, -1).join(', ')} and ${got[got.length - 1]}` : got[0]
  return `Found ${list}${r.how === 'labels' ? ' by the names you said' : ''}.${r.missing.length ? ` Not heard: ${r.missing.join(', ')}. Record ${r.missing.length === 1 ? 'it' : 'them'} on ${r.missing.length === 1 ? 'its' : 'their'} own and add ${r.missing.length === 1 ? 'it' : 'them'} to ${r.missing.length === 1 ? 'its column' : 'their columns'}.` : ''}`
}

// ── A TALKING TAKE, CUT IN THE BACKGROUND (Seb, 2026-11-28: "one long video of
// me just talking ... and have it properly cut") ────────────────────────────
/** A cut the video server is doing, kept in trybe_directory_meta under
 *  studiocut:<id> until it posts back (app/api/labs/trybe-studio/cut-callback). */
export interface CutJob {
  userId: string; projectId: string; state: 'cutting' | 'done' | 'failed'; at: string
  /** The one recording in the creator's folder, deleted once cut. */
  own: string
  parts: Array<{ label: string; kind: SplitKind; heard: string; start: number; end: number; url?: string; seconds?: number; bytes?: number }>
  missing: string[]; words: string; error?: string
}
/** A cut not posted back in this long was lost (the server restarted). */
export const CUT_STALE_MS = 45 * 60_000

/** The video server's answer put on the parts: each with its file, or the
 *  cut failed with why. Pure. */
export function cutDone(job: CutJob, posted: { ok?: unknown; error?: unknown; cuts?: unknown }, at: string): CutJob {
  if (posted.ok !== true) return { ...job, state: 'failed', at, error: String(posted.error || 'the video server gave no reason').slice(0, 300) }
  const list = Array.isArray(posted.cuts) ? posted.cuts as Array<{ id?: unknown; url?: unknown; seconds?: unknown; bytes?: unknown }> : []
  const byId = new Map(list.filter((c) => typeof c.url === 'string' && /^https:\/\//.test(c.url as string)).map((c) => [String(c.id), c]))
  const parts = job.parts.map((p) => { const c = byId.get(p.label); return c ? { ...p, url: String(c.url), seconds: Number(c.seconds) || undefined, bytes: Number(c.bytes) || undefined } : p })
  const cut = parts.filter((p) => p.url).length
  if (!cut) return { ...job, parts, state: 'failed', at, error: 'The video server cut none of the parts.' }
  return { ...job, parts, state: 'done', at }
}
