// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S TIMELINE (Seb, 2026-10-30: "prop up your phone or prop
// up your camera, shoot in one go your video review, and then the next file,
// shoot all of the B-roll without cutting ... MVP can use those two files to
// make a proper video review").
//
// The review take is written down word by word (Whisper), broken into lines,
// and the planner (lib/review-edit-plan) says which lines are mistakes,
// restarts or chatter, which lines land a strong point, and which B-roll shot
// goes under which line. Everything after that is these rules, with no AI:
//   • what is kept, with each pause over half a second shortened;
//   • where every kept second lands in the finished video;
//   • the B-roll moments, the slow zooms and the captions on that timeline.
// The video server (ingest-service/edit-filters) uses the same frame grid, so
// a B-roll moment computed here is the frame it shows on. Pure, tested in
// scripts/test-review-edit.

export const FPS = 30
/** Kept before the first word of a line and after its last. */
export const PAD_IN = 0.08
export const PAD_OUT = 0.18
/** A pause longer than this between kept lines is shortened to PAD_OUT + PAD_IN. */
export const MAX_PAUSE = 0.5
/** The last line keeps a little more, so the video does not stop on the word. */
export const END_TAIL = 0.5

/** TWO KINDS OF VIDEO, DIFFERENT FROM THE START (Seb, 2026-10-30: "Tribe is a
 *  different way of making a video. It's an ad. It's not really a video
 *  review"). A review for Amazon and YouTube is filmed sideways and edited at
 *  a talking pace; its Shorts, TikTok and Reels come later from the finished
 *  review, through Drop. A TRYBE ad is filmed upright and edited as an ad:
 *  tighter pauses, B-roll sooner and shorter, captions, a hook on screen, and
 *  no creator logo, because it runs as the brand's ad. */
export type VideoKind = 'review' | 'trybe'
export const KIND_WORDS: Record<VideoKind, { name: string; line: string }> = {
  review: { name: 'Amazon and YouTube review', line: 'Filmed sideways. Edited as a review, wide, for Amazon and YouTube. Its Shorts, TikTok and Reels come from it later, through Drop.' },
  trybe: { name: 'TRYBE ad', line: 'Filmed upright. Edited as an ad: tight, captions on, a hook at the start, no logo. Vertical, for the TRYBE brand.' },
}
/** TIGHT (Seb, 2026-10-30: "there's still a lot of dead air ... I think we
 *  should really focus on making it ... tighter"). Besides the gaps between
 *  words, every quiet stretch the sound itself shows (the video server's
 *  silencedetect) longer than minSilence is cut, keeping tailKeep after the
 *  last sound so a word's soft ending stays, and headKeep before the next. */
export interface Pace {
  padIn: number; padOut: number; maxPause: number; brollNotBefore: number; brollMax: number
  minSilence: number; tailKeep: number; headKeep: number
}
export const PACE: Record<VideoKind, Pace> = {
  review: { padIn: 0.06, padOut: 0.12, maxPause: 0.3, brollNotBefore: 2.5, brollMax: 4, minSilence: 0.3, tailKeep: 0.1, headKeep: 0.05 },
  trybe: { padIn: 0.05, padOut: 0.08, maxPause: 0.18, brollNotBefore: 1.5, brollMax: 3, minSilence: 0.22, tailKeep: 0.07, headKeep: 0.04 },
}

export interface Word { start: number; end: number; text: string }
/** w0..w1: its words, both included, in the take's sorted word list. */
export interface Line { i: number; start: number; end: number; text: string; w0: number; w1: number }

export type CutKind = 'restart' | 'mistake' | 'repeat' | 'chatter'
export interface Cut {
  /** Line numbers, both included. */
  from: number
  to: number
  kind: CutKind
  why: string
  /** Only these words of the line (a restart with no pause before the
   *  retake): word numbers in the take, both included. */
  words?: [number, number]
  /** The creator put it back. */
  restored?: boolean
}

/** A shot in the B-roll take, seconds into that take. */
export interface Shot { n: number; start: number; end: number; what: string }
export interface Placement { shot: number; line: number; why: string; off?: boolean }

export interface Plan {
  cuts: Cut[]
  /** Lines that land a strong point: a slow zoom goes on them. */
  keys: number[]
  placements: Placement[]
  /** A short title MVP suggests for the screen. */
  title: string
}

export type Segment = [number, number]
export interface Insert { at: number; len: number; from: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000
const onGrid = (s: number) => Math.round(s * FPS) / FPS

/** The take's words, cleaned and in time order: the list every word number
 *  refers to. Pure. */
export function cleanWords(words: Word[]): Word[] {
  return (Array.isArray(words) ? words : [])
    .filter((w) => w && typeof w.text === 'string' && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ start: Number(w.start), end: Math.max(Number(w.end), Number(w.start) + 0.05), text: w.text.trim() }))
    .sort((a, b) => a.start - b.start)
}

/** Words (cleanWords) broken into lines: after a pause over 0.4 seconds, at
 *  the end of a sentence once the line has four words, or at fourteen
 *  words. Pure. */
export function linesOf(words: Word[]): Line[] {
  const out: Line[] = []
  let w0 = -1
  const close = (w1: number) => {
    if (w0 < 0) return
    const ws = words.slice(w0, w1 + 1)
    out.push({ i: out.length, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'), w0, w1 })
    w0 = -1
  }
  words.forEach((w, k) => {
    if (w0 >= 0) {
      const prev = words[k - 1]
      if (w.start - prev.end > 0.4 || k - w0 >= 14 || (k - w0 >= 4 && /[.!?]$/.test(prev.text))) close(k - 1)
    }
    if (w0 < 0) w0 = k
  })
  close(words.length - 1)
  return out
}

/** Which words are cut (a cut the creator put back does not count). Pure. */
export function cutWords(lines: Line[], cuts: Cut[]): Set<number> {
  const out = new Set<number>()
  for (const c of cuts) {
    if (c.restored) continue
    if (c.words) { for (let k = c.words[0]; k <= c.words[1]; k++) out.add(k); continue }
    for (let i = Math.max(0, c.from); i <= Math.min(lines.length - 1, c.to); i++) for (let k = lines[i].w0; k <= lines[i].w1; k++) out.add(k)
  }
  return out
}

/** Which lines are cut whole. Pure. */
export function cutLines(lines: Line[], cuts: Cut[]): Set<number> {
  const gone = cutWords(lines, cuts)
  return new Set(lines.filter((l) => { for (let k = l.w0; k <= l.w1; k++) if (!gone.has(k)) return false; return true }).map((l) => l.i))
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']+/g, '')

/** The words of a line that match `text` (the planner quoting a restart), as
 *  word numbers in the take, or null. Pure. */
export function findWords(words: Word[], line: Line, text: string): [number, number] | null {
  const want = String(text || '').split(/\s+/).map(norm).filter(Boolean)
  if (!want.length) return null
  for (let k = line.w0; k + want.length - 1 <= line.w1; k++) {
    let ok = true
    for (let j = 0; j < want.length && ok; j++) ok = norm(words[k + j].text) === want[j]
    if (ok) return [k, k + want.length - 1]
  }
  return null
}

/** On the frame grid: touching parts joined, parts under two frames dropped.
 *  The video server snaps the same way, so the two agree to the frame. Pure. */
export function snapSegments(segs: Segment[]): Segment[] {
  // Whole frames throughout (no rounding to the millisecond), so a hundred
  // cuts add up to exactly the frames the video server keeps.
  const out: [number, number][] = []
  for (const [a0, b0] of segs) {
    let ka = Math.max(0, Math.round(a0 * FPS))
    const kb = Math.round(b0 * FPS)
    const prev = out[out.length - 1]
    if (prev && ka < prev[1]) ka = prev[1]
    if (kb - ka < 2) continue
    if (prev && ka === prev[1]) { prev[1] = kb; continue }
    out.push([ka, kb])
  }
  return out.map(([ka, kb]) => [ka / FPS, kb / FPS])
}

/** The parts of the review take to keep, in seconds of the take: every word
 *  not cut, with a little room either side that never reaches into a cut
 *  word, and pauses over MAX_PAUSE shortened. Pure. */
export function keepSegments(words: Word[], lines: Line[], cuts: Cut[], duration: number, pace: Pace = PACE.review, silences: Segment[] = []): Segment[] {
  const gone = cutWords(lines, cuts)
  const segs: Segment[] = []
  let prevKept = -2
  let lastEnd = 0
  words.forEach((w, k) => {
    if (gone.has(k)) return
    const before = words[k - 1], after = words[k + 1]
    const a = Math.max(0, w.start - pace.padIn, before && gone.has(k - 1) ? before.end : 0)
    const b = Math.min(duration, w.end + pace.padOut, after && gone.has(k + 1) ? after.start : Infinity)
    const seg = segs[segs.length - 1]
    if (seg && k === prevKept + 1 && w.start - words[k - 1].end <= pace.maxPause) seg[1] = Math.max(seg[1], b)
    else if (seg && a <= seg[1]) seg[1] = Math.max(seg[1], b)
    else segs.push([a, b])
    prevKept = k
    lastEnd = w.end
  })
  if (segs.length && prevKept === words.length - 1) segs[segs.length - 1][1] = Math.min(duration, Math.max(segs[segs.length - 1][1], lastEnd + END_TAIL))
  return snapSegments(withoutSilences(segs, silences, pace))
}

/** The kept parts with every long quiet stretch taken out, but for a little
 *  at each side: what jump cuts the dead air. Pure. */
export function withoutSilences(segs: Segment[], silences: Segment[], pace: Pace): Segment[] {
  const gaps = (Array.isArray(silences) ? silences : [])
    .filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] - x[0] > pace.minSilence)
    .map(([a, b]) => [a + pace.tailKeep, b - pace.headKeep] as Segment)
    .filter(([a, b]) => b - a > 0.05)
  if (!gaps.length) return segs
  const out: Segment[] = []
  for (const [a0, b0] of segs) {
    let pieces: Segment[] = [[a0, b0]]
    for (const [ga, gb] of gaps) {
      if (gb <= a0 || ga >= b0) continue
      pieces = pieces.flatMap(([a, b]) => (gb <= a || ga >= b ? [[a, b] as Segment] : [[a, Math.min(b, ga)] as Segment, [Math.max(a, gb), b] as Segment].filter(([x, y]) => y - x > 0.04)))
    }
    out.push(...pieces)
  }
  return out
}

export function editLength(segs: Segment[]): number {
  return segs.reduce((n, [a, b]) => n + Math.round((b - a) * FPS), 0) / FPS
}

/** Where a second of the take lands in the finished video, or null when it
 *  was cut. Pure. */
export function toOutput(segs: Segment[], s: number): number | null {
  let acc = 0
  for (const [a, b] of segs) {
    if (s >= a && s < b) return r3(acc + (s - a))
    acc += b - a
  }
  return null
}

/** The end of the kept part a second of the take is in, in finished-video
 *  seconds: the next cut. Pure. */
function partEnd(segs: Segment[], s: number): number | null {
  let acc = 0
  for (const [a, b] of segs) {
    if (s >= a && s < b) return r3(acc + (b - a))
    acc += b - a
  }
  return null
}

/** The words that are kept, on the finished video's timeline, for captions.
 *  Pure. */
export function outputWords(words: Word[], segs: Segment[]): Word[] {
  const out: Word[] = []
  for (const w of words) {
    const a = toOutput(segs, w.start)
    if (a == null) continue
    const b = toOutput(segs, Math.max(w.start, w.end - 0.001))
    out.push({ start: a, end: b == null ? r3(a + Math.min(0.6, w.end - w.start)) : r3(b + 0.001), text: w.text })
  }
  return out
}

/** No B-roll over the opening: the first seconds are the creator's face
 *  (a review's; an ad's opening is shorter, PACE). */
export const BROLL_NOT_BEFORE = PACE.review.brollNotBefore
/** A B-roll moment lasts this long at most. */
export const BROLL_MAX = PACE.review.brollMax

/** The B-roll moments on the finished video: each shot under its line, a
 *  little after the line starts, for up to four seconds, never overlapping
 *  and never in the opening. Pure. */
export function insertsFor(placements: Placement[], shots: Shot[], lines: Line[], segs: Segment[], pace: Pace = PACE.review): Insert[] {
  const total = editLength(segs)
  const want: Insert[] = []
  for (const p of placements) {
    if (p.off) continue
    const shot = shots.find((s) => s.n === p.shot)
    const line = lines[p.line]
    if (!shot || !line) continue
    const at0 = toOutput(segs, line.start + 0.2) ?? toOutput(segs, line.start)
    if (at0 == null) continue // the line was cut
    const shotLen = shot.end - shot.start
    // Never in the opening: a moment there moves to just after it, and its
    // length is measured from where it now starts.
    const at = onGrid(Math.max(at0, pace.brollNotBefore))
    const len = Math.min(pace.brollMax, shotLen, total - at)
    if (len < 1.5) continue
    // Start a little into the shot, past the moment the camera settles.
    const from = shotLen - len > 0.6 ? shot.start + 0.3 : shot.start
    want.push({ at: r3(at), len: r3(Math.floor(len * FPS + 0.01) / FPS), from: r3(from) })
  }
  want.sort((a, b) => a.at - b.at)
  const out: Insert[] = []
  for (const x of want) {
    const prev = out[out.length - 1]
    if (prev && x.at < prev.at + prev.len + 0.5) continue
    if (x.at + x.len > total) continue
    out.push(x)
  }
  return out
}

/** Slow push-in on each strong line, from the line to the next cut (where
 *  the picture comes back to normal), when that is 1.5 to 8 seconds. Pure. */
/** Slow push-in on each strong line (Seb, 2026-10-30: "very, very short
 *  and almost not ... I couldn't even see them"): from the line, over the
 *  whole line and a little after, 3 to 7 seconds, ending at the next cut
 *  when one comes within two seconds, so the picture returns on a cut. The
 *  video server eases in and out of each (edit-filters zoomExpr). Pure. */
export function zoomsFor(keys: number[], lines: Line[], segs: Segment[]): Segment[] {
  const total = editLength(segs)
  const out: Segment[] = []
  for (const k of [...new Set(keys)].sort((a, b) => a - b)) {
    const line = lines[k]
    if (!line) continue
    const a = toOutput(segs, line.start)
    if (a == null) continue
    const za = r3(Math.max(0, a - 0.1))
    const lineEnd = toOutput(segs, Math.max(line.start, line.end - 0.02)) ?? za + 3
    let zb = Math.min(za + 7, Math.max(za + 3, lineEnd + 0.6))
    const cut = partEnd(segs, Math.max(line.start, line.end - 0.02))
    if (cut != null && cut >= zb && cut - zb <= 2 && cut - za <= 8) zb = cut
    zb = r3(Math.min(zb, total))
    if (zb - za < 2) continue
    if (out.length && za < out[out.length - 1][1] + 1) continue
    out.push([za, zb])
  }
  return out
}

// ── What the creator chooses ─────────────────────────────────────────────────

export type Position = 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right' | 'top' | 'bottom'
export const POSITIONS: Position[] = ['upper-left', 'top', 'upper-right', 'lower-left', 'bottom', 'lower-right']
export const POSITION_WORDS: Record<Position, string> = {
  'upper-left': 'Top left', top: 'Top', 'upper-right': 'Top right',
  'lower-left': 'Bottom left', bottom: 'Bottom', 'lower-right': 'Bottom right',
}
export type Format = 'wide' | 'vertical'
export const FORMAT_WORDS: Record<Format, string> = {
  wide: 'Wide, for Amazon and YouTube',
  vertical: 'Vertical, for the TRYBE brand',
}

export type LogoSize = 'small' | 'medium' | 'large'
export const LOGO_SIZES: LogoSize[] = ['small', 'medium', 'large']
/** How wide the logo is, as a share of the frame's width. */
export const LOGO_WIDTH: Record<LogoSize, { wide: number; vertical: number }> = {
  small: { wide: 0.08, vertical: 0.15 }, medium: { wide: 0.12, vertical: 0.22 }, large: { wide: 0.18, vertical: 0.32 },
}
/** Solid, or a see-through stamp (Seb, 2026-10-30: "a 50% transparency stamp"). */
export const LOGO_OPACITY = [1, 0.7, 0.5, 0.3]
const nearestOpacity = (v: number) => LOGO_OPACITY.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), 1)

export interface EditSettings {
  /** Chosen first, and never changed after: it decides the format. */
  kind: VideoKind
  /** From the kind: a review is wide, a TRYBE ad vertical. */
  formats: Format[]
  /** On the whole video, in its corner, as solid or as a see-through stamp. */
  logo: { url: string; position: Position; on: boolean; opacity: number; size: LogoSize } | null
  title: { text: string; position: Position; seconds: number; on: boolean }
  /** Word by word captions, on a TRYBE ad. */
  captions: boolean
  zooms: boolean
  color: boolean
  broll: boolean
  /** Where the vertical version is cut from a sideways take: 0 left, 1 right. */
  cropX: number
}

export const DEFAULT_SETTINGS: EditSettings = {
  kind: 'review',
  formats: ['wide'],
  logo: null,
  title: { text: '', position: 'top', seconds: 4, on: false },
  captions: true,
  zooms: true,
  color: true,
  broll: true,
  cropX: 0.5,
}

const isPos = (v: unknown): v is Position => typeof v === 'string' && (POSITIONS as string[]).includes(v)

/** Settings from anywhere (the page, a saved row, the prompt box), made safe.
 *  Pure. */
export function cleanSettings(raw: unknown, base: EditSettings = DEFAULT_SETTINGS): EditSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind: VideoKind = r.kind === 'trybe' || r.kind === 'review' ? r.kind : base.kind ?? 'review'
  const lr = r.logo && typeof r.logo === 'object' ? r.logo as Record<string, unknown> : null
  const logoUrl = lr && typeof lr.url === 'string' && /^https:\/\//.test(lr.url) ? lr.url : base.logo?.url ?? null
  const tr = r.title && typeof r.title === 'object' ? r.title as Record<string, unknown> : {}
  const bool = (k: keyof EditSettings) => (typeof r[k] === 'boolean' ? r[k] as boolean : base[k] as boolean)
  return {
    kind,
    formats: kind === 'trybe' ? ['vertical'] : ['wide'],
    logo: logoUrl ? {
      url: logoUrl,
      position: isPos(lr?.position) ? lr!.position as Position : base.logo?.position ?? 'upper-left',
      on: typeof lr?.on === 'boolean' ? lr.on as boolean : base.logo?.on ?? true,
      opacity: Number.isFinite(Number(lr?.opacity)) && lr?.opacity != null ? nearestOpacity(Number(lr.opacity)) : base.logo?.opacity ?? 1,
      size: LOGO_SIZES.includes(lr?.size as LogoSize) ? lr!.size as LogoSize : base.logo?.size ?? 'medium',
    } : null,
    title: {
      text: typeof tr.text === 'string' ? tr.text.replace(/\s*[–—]\s*/g, ', ').replace(/\s+-\s+/g, ', ').trim().slice(0, 60) : base.title.text,
      position: isPos(tr.position) ? tr.position : base.title.position,
      seconds: Math.max(2, Math.min(15, Number(tr.seconds) || base.title.seconds)),
      on: typeof tr.on === 'boolean' ? tr.on : base.title.on,
    },
    captions: bool('captions'),
    zooms: bool('zooms'),
    color: bool('color'),
    broll: bool('broll'),
    cropX: Math.max(0, Math.min(1, Number.isFinite(Number(r.cropX)) ? Number(r.cropX) : base.cropX)),
  }
}

/** Everything the video server needs for one edit, worked out from the plan
 *  and the settings. Pure. */
export function renderSpec(o: { words: Word[]; lines: Line[]; plan: Plan; shots: Shot[]; duration: number; settings: EditSettings; hasBroll: boolean; silences?: Segment[] }) {
  const pace = PACE[o.settings.kind]
  const segments = keepSegments(o.words, o.lines, o.plan.cuts, o.duration, pace, o.silences ?? [])
  const inserts = o.settings.broll && o.hasBroll ? insertsFor(o.plan.placements, o.shots, o.lines, segments, pace) : []
  const zooms = o.settings.zooms ? zoomsFor(o.plan.keys, o.lines, segments) : []
  const words = o.settings.captions && o.settings.kind === 'trybe' ? outputWords(o.words, segments) : []
  // A TRYBE ad runs as the brand's ad: never the creator's logo on it.
  const logo = o.settings.kind === 'review' && o.settings.logo?.on ? o.settings.logo : null
  return { segments, inserts, zooms, words, logo, seconds: editLength(segments) }
}

/** "1:05" for a second count. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
