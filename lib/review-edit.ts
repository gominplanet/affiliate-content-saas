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

import { normalizeAsinInput, asinInFileName } from '@/lib/asin'
import { productFromName } from '@/lib/review-edit-batch'

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
  trybe: { name: 'TRYBE ad', line: 'Filmed upright. Edited as an ad: tight, a hook at the start, no logo. Vertical, for the TRYBE brand.' },
}

/** What a kind of video is, said with this creator's captions setting, so a
 *  TRYBE ad never reads "captions on" while their look has them off (Seb,
 *  2026-11-04, whose look had the box unticked). Pure. */
export function kindLine(kind: VideoKind, captions: boolean): string {
  if (kind !== 'trybe') return KIND_WORDS[kind].line
  return `${KIND_WORDS.trybe.line} ${captions ? 'Word by word captions on.' : 'No captions: they are off in Your look.'}`
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
/** WITH SLACK (Seb, 2026-11-02: "it has cut ... the ends of words and starts
 *  of words ... Can we give it a little bit more slack so it doesn't seem so
 *  abrupt?"). Twice the room round each word, a pause under half a second
 *  left as a breath, and about a third of a second of it kept where a longer
 *  one is cut (tailKeep + headKeep). An ad stays tighter than a review. */
export const PACE: Record<VideoKind, Pace> = {
  review: { padIn: 0.12, padOut: 0.2, maxPause: 0.4, brollNotBefore: 2.5, brollMax: 4, minSilence: 0.45, tailKeep: 0.2, headKeep: 0.12 },
  trybe: { padIn: 0.08, padOut: 0.14, maxPause: 0.25, brollNotBefore: 1.5, brollMax: 3, minSilence: 0.32, tailKeep: 0.13, headKeep: 0.08 },
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
  /** The product as the creator names it in the take, when they do (plans
   *  made from 2026-11-03 on): for the file name of the finished video. */
  product?: string
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
/** A picture can also sit in the middle of the frame. */
export type Spot = Position | 'center'
export const SPOTS: Spot[] = [...POSITIONS, 'center']
export const POSITION_WORDS: Record<Spot, string> = {
  'upper-left': 'Top left', top: 'Top', 'upper-right': 'Top right',
  'lower-left': 'Bottom left', bottom: 'Bottom', 'lower-right': 'Bottom right', center: 'Middle',
}
export type Format = 'wide' | 'vertical'
export const FORMAT_WORDS: Record<Format, string> = {
  wide: 'Wide, for Amazon and YouTube',
  vertical: 'Vertical, for the TRYBE brand',
}

/** A finished video as a file to keep (Seb, 2026-11-02: "what about a
 *  download button if users want to keep the video"). The video lives on
 *  MVP's storage, another address from the page, where a browser ignores a
 *  link's download attribute and just plays the video; storage's own
 *  `download` setting makes it save, under the video's name ("Bassdash Sun
 *  Hoodie.mp4", "… vertical.mp4" when there are two). Any other address is
 *  left as it is. Pure. */
export function downloadLink(url: string, name: string | null | undefined, format?: Format, both = false): { href: string; file: string } {
  const base = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Review'
  const file = `${base}${both && format ? ` ${format}` : ''}.mp4`
  if (!/\/storage\/v1\/object\/public\//.test(url)) return { href: url, file }
  return { href: `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(file)}`, file }
}

/** What a finished video's file is called (Seb, 2026-11-03: "could the
 *  download link have the ASIN in the file name (if it is an amazon video) if
 *  it's not an amazon product, let's at least have the product name").
 *
 *  The ASIN, when MVP knows it: typed as the product (an ASIN or an Amazon
 *  link), set in Drop, or in a take's file name. The product: as typed, else
 *  as MVP heard it named in the take, else the video's or a take's name when
 *  a person wrote it (never a camera's IMG_0097). "Ninja Crispi B0DDDD8WD6": the ASIN
 *  standing on its own, the way Drop and Liftoff read it back from a file
 *  name (lib/asin asinInFileName). Pure. */
export function keepName(o: { product?: string | null; heard?: string | null; name?: string | null; files?: string[]; dropAsin?: string | null }): { base: string; asin: string | null; product: string | null } {
  const typed = String(o.product || '').trim()
  const fromText = (t: string | null | undefined) => (t ? normalizeAsinInput(t.trim()) ?? asinInFileName(t) : null)
  const inFiles = Array.from(new Set((o.files ?? []).map((f) => asinInFileName(f)).filter((x): x is string => !!x)))
  const asin = fromText(typed) ?? fromText(o.dropAsin) ?? (inFiles.length === 1 ? inFiles[0] : null)
  // Words a person would call the product: no link, no ASIN.
  const words = (t: string | null | undefined) => String(t || '').replace(/https?:\/\/\S+/gi, ' ').replace(/(?<![A-Za-z0-9])B0[A-Za-z0-9]{8}(?![A-Za-z0-9])/g, ' ')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)
  const heard = String(o.heard || '').replace(/^(a|an|the)\s+/i, '')
  const product = words(typed) || words(heard) || [o.name, ...(o.files ?? [])].map((n) => words(productFromName(String(n || '')))).find(Boolean) || null
  return { base: [product, asin].filter(Boolean).join(' ') || 'Review', asin, product }
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

// TITLE LOOKS (Seb, 2026-10-30: "different fonts, different ways to write
// those titles"). Each look is a font MVP ships with its own treatment; the
// creator picks one, a colour and a size. lib/title-looks draws it.
export type TitleLook = 'clean' | 'bold' | 'caps' | 'highlight' | 'marker' | 'tech' | 'fun'
export const TITLE_LOOKS: TitleLook[] = ['clean', 'bold', 'caps', 'highlight', 'marker', 'tech', 'fun']
export const TITLE_LOOK_WORDS: Record<TitleLook, string> = {
  clean: 'Clean box', bold: 'Bold outline', caps: 'Tall capitals', highlight: 'Highlighter',
  marker: 'Marker pen', tech: 'Tech badge', fun: 'Comic',
}
/** The colour picked: the text's, or the box's on a look with a box. */
export type TitleColor = 'white' | 'yellow' | 'black' | 'red' | 'blue' | 'purple' | 'green'
export const TITLE_COLORS: Record<TitleColor, string> = {
  white: '#FFFFFF', yellow: '#FFD400', black: '#111111', red: '#E11D48', blue: '#2563EB', purple: '#7C3AED', green: '#16A34A',
}
/** The text's height in pixels on a 1920 wide frame, before the look's own scale. */
export const TITLE_PX: Record<LogoSize, number> = { small: 46, medium: 64, large: 86 }
/** Seconds a title stays; 0 is the whole video (a disclosure, Seb's
 *  "PROVIDED SAMPLE IN EXCHANGE FOR VIDEO REVIEW #AD"). */
export const TITLE_SECONDS = [3, 4, 5, 6, 8, 10, 0]

// PICTURES ON SCREEN (Seb, 2026-10-30: "add things to the screen by
// uploads, like PNGs"). A PNG from the creator's own library, in a spot, for
// the whole video, the start, the end, or from the moment they say a phrase.
export type PictureWhen = 'whole' | 'start' | 'end' | 'say'
/** The logo: the whole video, the first seconds, or the last (Seb,
 *  2026-10-30: "either the first 5 seconds, the last 5 seconds, or the
 *  entire video, or nothing at all"; nothing at all is switching it off). */
export type LogoWhen = 'whole' | 'start' | 'end'
export const LOGO_WHEN_WORDS: Record<LogoWhen, string> = { whole: 'The whole video', start: 'The first seconds', end: 'The last seconds' }
/** Seconds a logo or picture shows at the start or the end, unless chosen. */
export const SHOW_SECONDS = 5
export const PICTURE_WHEN_WORDS: Record<PictureWhen, string> = {
  whole: 'The whole video', start: 'At the start', end: 'At the end', say: 'When I say…',
}
export interface Picture { url: string; on: boolean; position: Spot; size: LogoSize; opacity: number; when: PictureWhen; seconds: number; say: string }
export const MAX_PICTURES = 4
/** How wide a picture is, as a share of the frame's width. */
export const PICTURE_WIDTH: Record<LogoSize, { wide: number; vertical: number }> = {
  small: { wide: 0.12, vertical: 0.25 }, medium: { wide: 0.2, vertical: 0.4 }, large: { wide: 0.3, vertical: 0.6 },
}

export interface EditSettings {
  /** Chosen first, and never changed after: it decides the format. */
  kind: VideoKind
  /** From the kind: a review is wide, a TRYBE ad vertical. */
  formats: Format[]
  /** On the whole video, in its corner, as solid or as a see-through stamp. */
  logo: { url: string; position: Position; on: boolean; opacity: number; size: LogoSize; when: LogoWhen; seconds: number } | null
  /** seconds 0 is the whole video. */
  title: { text: string; position: Position; seconds: number; on: boolean; look: TitleLook; color: TitleColor; size: LogoSize }
  /** PNGs from the creator's library, each with its spot and its moment. */
  pictures: Picture[]
  /** Word by word captions, on a TRYBE ad. */
  captions: boolean
  zooms: boolean
  color: boolean
  broll: boolean
  /** Where the vertical version is cut from a sideways take: 0 left, 1 right. */
  cropX: number
  /** The product's titles on screen, chosen by the creator before adding
   *  (calloutTimes): one video's own, never part of the saved look. */
  callouts: string[]
  /** How the product titles look and where they sit: part of the look. */
  calloutLook: CalloutLook
}

export const DEFAULT_SETTINGS: EditSettings = {
  kind: 'review',
  formats: ['wide'],
  logo: null,
  title: { text: '', position: 'top', seconds: 4, on: false, look: 'clean', color: 'white', size: 'medium' },
  pictures: [],
  captions: true,
  zooms: true,
  color: true,
  broll: true,
  cropX: 0.5,
  callouts: [],
  calloutLook: { look: 'clean', color: 'white', size: 'small', spot: 'auto', seconds: 4 },
}

const isPos = (v: unknown): v is Position => typeof v === 'string' && (POSITIONS as string[]).includes(v)
const isSpot = (v: unknown): v is Spot => typeof v === 'string' && (SPOTS as string[]).includes(v)
const pick = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? v as T : fallback)

/** A picture from anywhere, made safe; null when it has no https address. Pure. */
function cleanPicture(raw: unknown, base?: Picture): Picture | null {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const url = typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p.url : base?.url
  if (!url) return null
  const when = pick<PictureWhen>(p.when, ['whole', 'start', 'end', 'say'], base?.when ?? 'whole')
  const say = typeof p.say === 'string' ? p.say.replace(/[\u2013\u2014]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : base?.say ?? ''
  return {
    url,
    on: typeof p.on === 'boolean' ? p.on : base?.on ?? true,
    position: isSpot(p.position) ? p.position : base?.position ?? 'lower-right',
    size: pick<LogoSize>(p.size, LOGO_SIZES, base?.size ?? 'medium'),
    opacity: Number.isFinite(Number(p.opacity)) && p.opacity != null ? nearestOpacity(Number(p.opacity)) : base?.opacity ?? 1,
    // A moment with no words to wait for is shown at the start instead.
    when: when === 'say' && !say ? 'start' : when,
    seconds: Math.max(1, Math.min(15, Math.round(Number(p.seconds)) || base?.seconds || SHOW_SECONDS)),
    say,
  }
}

/** Settings from anywhere (the page, a saved row, the prompt box), made safe.
 *  Pure. */
export function cleanSettings(raw: unknown, base: EditSettings = DEFAULT_SETTINGS): EditSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind: VideoKind = r.kind === 'trybe' || r.kind === 'review' ? r.kind : base.kind ?? 'review'
  const lr = r.logo && typeof r.logo === 'object' ? r.logo as Record<string, unknown> : null
  const logoUrl = lr && typeof lr.url === 'string' && /^https:\/\//.test(lr.url) ? lr.url : base.logo?.url ?? null
  const tr = r.title && typeof r.title === 'object' ? r.title as Record<string, unknown> : {}
  const bool = (k: keyof EditSettings) => (typeof r[k] === 'boolean' ? r[k] as boolean : base[k] as boolean)
  const title: EditSettings['title'] = {
    text: typeof tr.text === 'string' ? tr.text.replace(/\s*[–—]\s*/g, ', ').replace(/\s+-\s+/g, ', ').trim().slice(0, 80) : base.title.text,
    position: isPos(tr.position) ? tr.position : base.title.position,
    // 0 keeps it on for the whole video.
    seconds: tr.seconds == null || tr.seconds === '' ? base.title.seconds : Number(tr.seconds) === 0 ? 0 : Math.max(2, Math.min(15, Number(tr.seconds) || 4)),
    on: typeof tr.on === 'boolean' ? tr.on : base.title.on,
    look: pick<TitleLook>(tr.look, TITLE_LOOKS, base.title.look ?? 'clean'),
    color: pick<TitleColor>(tr.color, Object.keys(TITLE_COLORS) as TitleColor[], base.title.color ?? 'white'),
    size: pick<LogoSize>(tr.size, LOGO_SIZES, base.title.size ?? 'medium'),
  }
  // Product titles chosen before their own look existed followed the title's
  // look and colour, a size smaller: a video or look without one still does.
  const fromTitle: CalloutLook = { look: title.look, color: title.color, size: 'small', spot: 'auto', seconds: CALLOUT_SECONDS }
  const calloutLook = r.calloutLook && typeof r.calloutLook === 'object'
    ? cleanCalloutLook(r.calloutLook, base.calloutLook ?? fromTitle)
    : base !== DEFAULT_SETTINGS && base.calloutLook ? base.calloutLook : fromTitle
  return {
    kind,
    formats: kind === 'trybe' ? ['vertical'] : ['wide'],
    logo: logoUrl ? {
      url: logoUrl,
      position: isPos(lr?.position) ? lr!.position as Position : base.logo?.position ?? 'upper-left',
      on: typeof lr?.on === 'boolean' ? lr.on as boolean : base.logo?.on ?? true,
      opacity: Number.isFinite(Number(lr?.opacity)) && lr?.opacity != null ? nearestOpacity(Number(lr.opacity)) : base.logo?.opacity ?? 1,
      size: LOGO_SIZES.includes(lr?.size as LogoSize) ? lr!.size as LogoSize : base.logo?.size ?? 'medium',
      when: pick<LogoWhen>(lr?.when, ['whole', 'start', 'end'], base.logo?.when ?? 'whole'),
      seconds: lr?.seconds == null ? base.logo?.seconds ?? SHOW_SECONDS : Math.max(1, Math.min(15, Math.round(Number(lr.seconds)) || SHOW_SECONDS)),
    } : null,
    title,
    pictures: (Array.isArray(r.pictures) ? r.pictures : base.pictures ?? [])
      .map((p) => cleanPicture(p)).filter((p): p is Picture => !!p)
      .filter((p, i, all) => all.findIndex((q) => q.url === p.url) === i).slice(0, MAX_PICTURES),
    captions: bool('captions'),
    zooms: bool('zooms'),
    color: bool('color'),
    broll: bool('broll'),
    cropX: Math.max(0, Math.min(1, Number.isFinite(Number(r.cropX)) ? Number(r.cropX) : base.cropX)),
    callouts: cleanCallouts(Array.isArray(r.callouts) ? r.callouts : base.callouts ?? []),
    calloutLook,
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
  const seconds = editLength(segments)
  const pictures = pictureTimes(o.settings.pictures ?? [], o.words, segments, seconds)
  const t = o.settings.title
  // The opening title's seconds are kept clear; a title on the whole video
  // sends the product titles to the other edge of the frame instead.
  const busy = t.on && t.text && t.seconds > 0 ? [{ from: 0, to: 0.3 + t.seconds }] : []
  const callouts = calloutTimes(o.settings.callouts ?? [], o.words, segments, seconds, busy, o.settings.calloutLook?.seconds ?? CALLOUT_SECONDS)
  return { segments, inserts, zooms, words, logo, seconds, pictures, callouts, calloutSpot: calloutSpot(o.settings) }
}

/** The words of a phrase, wherever they are said, ignoring case and
 *  punctuation: the first time they are said in a part that was kept. Pure. */
export function whenSaid(words: Word[], segs: Segment[], phrase: string): number | null {
  const want = String(phrase || '').split(/\s+/).map(norm).filter(Boolean)
  if (!want.length) return null
  for (let k = 0; k + want.length <= words.length; k++) {
    let ok = true
    for (let j = 0; j < want.length && ok; j++) ok = norm(words[k + j].text) === want[j]
    if (!ok) continue
    const at = toOutput(segs, words[k].start)
    if (at != null) return at
  }
  return null
}

export type PictureTime = { k: number; url: string; from: number; to: number } | { k: number; url: string; missed: string }
/** When each picture is on screen in the finished video, in its seconds, or
 *  why it is not: a picture waiting for words never said is left out and
 *  said so, never quietly dropped. Pictures switched off are not listed. Pure. */
export function pictureTimes(pictures: Picture[], words: Word[], segs: Segment[], length: number): PictureTime[] {
  const out: PictureTime[] = []
  pictures.forEach((p, k) => {
    if (!p.on) return
    const len = Math.min(p.seconds, length)
    if (p.when === 'whole') out.push({ k, url: p.url, from: 0, to: r3(length) })
    else if (p.when === 'start') out.push({ k, url: p.url, from: 0.3, to: r3(Math.min(length, 0.3 + len)) })
    else if (p.when === 'end') out.push({ k, url: p.url, from: r3(Math.max(0, length - len)), to: r3(length) })
    else {
      const at = whenSaid(words, segs, p.say)
      if (at == null) out.push({ k, url: p.url, missed: `"${p.say}" is not said in the finished video, so this picture was left out.` })
      else out.push({ k, url: p.url, from: at, to: r3(Math.min(length, at + len)) })
    }
  })
  return out
}

// THE PRODUCT'S TITLES ON SCREEN (Seb, 2026-11-04: "MVP would do a little
// research on the product, and come up with ... 10 titles that MVP could
// burn on top of the video throughout the video", the creator choosing
// their top 5 before it is queued). Lines like "Full HD 1920x1080p" or
// "Projects on any flat surface". Each is on screen for a few seconds from
// the moment the creator talks about it (the rarest word it shares with
// what they say, so "Wifi 6 compatible" waits for "wifi", not "the"), and a
// title never mentioned is spread evenly through what is left. Never over
// the opening title or another product title, and one that finds no room
// is left out and said so.
export const MAX_CALLOUTS = 5
export const MAX_CALLOUT_CHARS = 70
/** Seconds each product title is on screen, unless chosen. */
export const CALLOUT_SECONDS = 4
export const CALLOUT_SECONDS_CHOICES = [3, 4, 5, 6]
/** How the product titles look (any of the title looks, Seb, 2026-11-04:
 *  "Can we have users select different ways that the titles can appear?"),
 *  and where: 'auto' is low on a review and high on a TRYBE ad (calloutSpot). */
export interface CalloutLook { look: TitleLook; color: TitleColor; size: LogoSize; spot: Position | 'auto'; seconds: number }

/** A product title look from anywhere, made safe. Pure. */
export function cleanCalloutLook(raw: unknown, fb: CalloutLook): CalloutLook {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    look: pick<TitleLook>(o.look, TITLE_LOOKS, fb.look),
    color: pick<TitleColor>(o.color, Object.keys(TITLE_COLORS) as TitleColor[], fb.color),
    size: pick<LogoSize>(o.size, LOGO_SIZES, fb.size),
    spot: o.spot === 'auto' || isPos(o.spot) ? o.spot as Position | 'auto' : fb.spot,
    seconds: CALLOUT_SECONDS_CHOICES.includes(Number(o.seconds)) ? Number(o.seconds) : fb.seconds,
  }
}
const CALLOUT_GAP = 0.6

/** The chosen titles, made safe: trimmed, short, no repeats, five at most. Pure. */
export function cleanCallouts(raw: unknown[]): string[] {
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.replace(/\s+/g, ' ').trim().slice(0, MAX_CALLOUT_CHARS).trim()
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= MAX_CALLOUTS) break
  }
  return out
}

/** Where the product titles sit: low on a review, high on a TRYBE ad (its
 *  captions are low), and away from a title kept on for the whole video. Pure. */
export function calloutSpot(s: Pick<EditSettings, 'kind' | 'title'> & { calloutLook?: CalloutLook }): Spot {
  if (s.calloutLook && s.calloutLook.spot !== 'auto') return s.calloutLook.spot
  const base: Spot = s.kind === 'trybe' ? 'top' : 'bottom'
  const t = s.title
  if (!t.on || !t.text || t.seconds !== 0) return base
  const high = (p: Spot) => p === 'top' || p === 'upper-left' || p === 'upper-right'
  return high(t.position) === high(base) ? (base === 'top' ? 'bottom' : 'top') : base
}

const CALLOUT_SKIP = new Set(['with', 'and', 'the', 'for', 'any', 'all', 'one', 'comes', 'come', 'your', 'you', 'this', 'that', 'from', 'into', 'onto', 'over', 'has', 'have', 'are', 'can', 'its', 'our', 'out', 'use', 'get', 'very', 'more', 'most', 'less', 'than', 'not', 'but', 'just', 'also', 'up', 'to', 'in', 'on', 'of', 'a', 'an', 'is', 'it', 'by', 'or', 'as', 'at', 'be', 'so', 'no', 'complete', 'compact', 'versatile', 'solution', 'design', 'easy', 'great', 'perfect', 'ideal', 'built', 'made', 'includes', 'included', 'compatible'])
const digitsOf = (t: string) => t.replace(/\D+/g, '')
/** The words of a title that could be heard: no small words, numbers kept
 *  ("1920x1080p" is 1920 and 1080p). Pure. */
export function calloutKeys(text: string): string[] {
  return [...new Set(String(text || '').replace(/(\d)x(\d)/gi, '$1 $2').split(/[^A-Za-z0-9']+/)
    .map((w) => w.replace(/'s$/i, ''))
    // A short word in capitals is a name ("HD", "TV", "UV"), kept.
    .filter((w) => w && (w.length >= 3 || /\d/.test(w) || /^[A-Z]{2}$/.test(w)))
    .map((w) => w.toLowerCase())
    .filter((w) => !CALLOUT_SKIP.has(w)))]
}

export type CalloutTime =
  | { k: number; text: string; from: number; to: number; heard: string | null }
  | { k: number; text: string; missed: string }

/** When each product title is on screen in the finished video, in its
 *  seconds, and the word that placed it (null: spread through the video);
 *  or why it is not on it. Pure. */
export function calloutTimes(callouts: string[], words: Word[], segs: Segment[], length: number, busy: { from: number; to: number }[] = [], seconds = CALLOUT_SECONDS): CalloutTime[] {
  const dur = Math.min(seconds, Math.max(0, length - 1))
  const taken = busy.map((b) => ({ ...b }))
  const fits = (from: number) => from >= 0.3 && from + dur <= length - 0.3
    && taken.every((b) => from + dur + CALLOUT_GAP <= b.from || from >= b.to + CALLOUT_GAP)
  const kept = outputWords(words, segs).map((w) => ({ at: w.start, n: norm(w.text), d: digitsOf(w.text) }))
  const out: CalloutTime[] = []
  const later: number[] = []
  if (dur < 2) return callouts.map((text, k) => ({ k, text, missed: 'The finished video is too short for product titles.' }))
  // Each title's heard words, rarest first ("wifi" before "compatible").
  const heard = callouts.map((text, k) => ({
    k, text,
    keys: calloutKeys(text).map((key) => {
      const d = digitsOf(key)
      return { key, hits: kept.filter((w) => (d ? w.d === d : w.n === key || w.n === `${key}s` || `${w.n}s` === key)).map((w) => w.at) }
    }).filter((x) => x.hits.length).sort((a, b) => a.hits.length - b.hits.length || b.key.length - a.key.length),
  }))
  // In the order they are talked about, each from the moment it is said, or
  // up to 3 seconds later when another title is still on screen.
  const first = (h: (typeof heard)[number]) => Math.min(...h.keys[0].hits)
  for (const h of heard.filter((x) => x.keys.length).sort((a, b) => first(a) - first(b))) {
    let placed = false
    for (const { key, hits } of h.keys) {
      for (const at of hits) {
        for (let off = 0; off <= 3 && !placed; off += 0.25) {
          const spot = r3(Math.max(0.3, at - 0.2 + off))
          if (!fits(spot)) continue
          out.push({ k: h.k, text: h.text, from: spot, to: r3(spot + dur), heard: key })
          taken.push({ from: spot, to: spot + dur })
          placed = true
        }
        if (placed) break
      }
      if (placed) break
    }
    if (!placed) later.push(h.k)
  }
  for (const h of heard) if (!h.keys.length) later.push(h.k)
  later.sort((a, b) => a - b)
  // Never mentioned: spread evenly through the room that is left.
  const start = Math.max(1.5, ...busy.map((b) => b.to + CALLOUT_GAP))
  const end = length - 1
  later.forEach((k, i) => {
    const text = callouts[k]
    const ideal = start + ((end - start - dur) * (i + 1)) / (later.length + 1)
    const tries: number[] = []
    for (let d = 0; d <= length; d += 0.5) tries.push(ideal + d, ideal - d)
    const spot = tries.map(r3).find(fits)
    if (spot == null) { out.push({ k, text, missed: 'There was no free moment for it in this video. Pick fewer titles, or make the video longer.' }); return }
    out.push({ k, text, from: spot, to: r3(spot + dur), heard: null })
    taken.push({ from: spot, to: spot + dur })
  })
  return out.sort((a, b) => a.k - b.k)
}

/** "1:05" for a second count. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
