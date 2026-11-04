// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT A VIDEO FILE SAYS ABOUT ITSELF, read in the browser before it is
// uploaded (Seb, 2026-11-04: "build batch upload too"): when it was filmed,
// how long it is, and whether it was filmed upright. A batch from the
// computer pairs its takes from this the way a Google Drive batch does from
// what the video server reads, so the creator checks the videos before a
// single byte goes up.
//
// MP4 and QuickTime (.mov) files keep this in their 'moov' box: the movie
// header (mvhd: when it was made, its timescale and length), each track's
// header (tkhd: width, height and the turn a player applies to it, which is
// how a phone marks a video filmed upright), and, from an iPhone, the date
// it was filmed with its time zone, as text. Only that box is read, wherever
// it sits in the file, so a 2 GB take costs a few reads, not 2 GB.
//
// The filming time follows the video server's rule (ingest-service
// edit-filters filmedAtFrom): the iPhone's own date first, then the file's
// creation time, and never a clock that was not set (before 2005) or a date
// to come. Pure except readVideoFacts, which only reads the Blob it is given.

export interface VideoFacts {
  /** When it was filmed (ISO), when the file says. */
  filmedAt: string | null
  seconds: number | null
  /** As it plays: an upright phone video is taller than wide. */
  width: number | null
  height: number | null
}

export const NO_FACTS: VideoFacts = { filmedAt: null, seconds: null, width: null, height: null }

/** The largest movie box read: far above any phone's (a few MB for an hour). */
const MOOV_MAX = 64 * 1024 * 1024
const EPOCH_1904_MS = Date.UTC(1904, 0, 1)

const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]
const i32 = (b: Uint8Array, p: number) => u32(b, p) | 0
const u64 = (b: Uint8Array, p: number) => u32(b, p) * 4294967296 + u32(b, p + 4)
const type4 = (b: Uint8Array, p: number) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3])

/** A filming time a person can trust, as ISO, or null. */
function trusted(ms: number, now: number): string | null {
  return Number.isFinite(ms) && ms >= Date.UTC(2005, 0, 1) && ms < now + 2 * 86400_000 ? new Date(ms).toISOString() : null
}

/** "2026-10-30T14:22:33-0400" (an iPhone's) or any ISO date, as ISO; null
 *  when it is not one to trust. Pure. */
export function filmedAtFromText(v: string | null | undefined, now = Date.now()): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  return trusted(Date.parse(v.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2')), now)
}

/** The boxes between start and end, each with where its contents begin and end. */
function children(b: Uint8Array, start: number, end: number): { type: string; at: number; from: number; to: number }[] {
  const out: { type: string; at: number; from: number; to: number }[] = []
  let p = start
  while (p + 8 <= end) {
    let size = u32(b, p)
    let head = 8
    if (size === 1) {
      if (p + 16 > end) break
      size = u64(b, p + 8)
      head = 16
    } else if (size === 0) size = end - p
    if (size < head) break
    // A box cut off where the read stopped is still read as far as it goes.
    out.push({ type: type4(b, p + 4), at: p, from: p + head, to: Math.min(end, p + size) })
    p += size
  }
  return out
}

/** The facts in a movie box's contents (the bytes after its 'moov' header). Pure. */
export function factsFromMoov(moov: Uint8Array, now = Date.now()): VideoFacts {
  const facts: VideoFacts = { ...NO_FACTS }
  let made: string | null = null
  for (const box of children(moov, 0, moov.length)) {
    if (box.type === 'mvhd' && box.to - box.from >= 20) {
      const s = box.from
      const v1 = moov[s] === 1
      const created = v1 ? u64(moov, s + 4) : u32(moov, s + 4)
      const scale = v1 ? u32(moov, s + 20) : u32(moov, s + 12)
      const length = v1 ? u64(moov, s + 24) : u32(moov, s + 16)
      if (created > 0) made = trusted(EPOCH_1904_MS + created * 1000, now)
      if (scale > 0 && length > 0) facts.seconds = Math.round((length / scale) * 10) / 10
    }
    if (box.type === 'trak' && facts.width == null) {
      const tkhd = children(moov, box.from, box.to).find((c) => c.type === 'tkhd')
      if (!tkhd) continue
      const s = tkhd.from
      const at = moov[s] === 1 ? s + 52 : s + 40 // the turn, then width and height
      if (at + 44 > tkhd.to) continue
      const w = Math.round(u32(moov, at + 36) / 65536)
      const h = Math.round(u32(moov, at + 40) / 65536)
      if (!w || !h) continue // a sound track
      // A quarter turn (a 0, b ±1) plays it the other way round.
      const quarter = Math.abs(i32(moov, at)) < Math.abs(i32(moov, at + 4))
      facts.width = quarter ? h : w
      facts.height = quarter ? w : h
    }
  }
  facts.filmedAt = appleDate(moov, 0, moov.length, now) || made
  return facts
}

const APPLE_DATE = 'com.apple.quicktime.creationdate'

/** An iPhone's own filming date, with its time zone: a named value in the
 *  movie's metadata (a 'meta' box, in the movie or its 'udta', holding the
 *  names in 'keys' and the values in 'ilst', each value numbered by its
 *  name's place in the list). Null when the file has none. */
function appleDate(b: Uint8Array, start: number, end: number, now: number): string | null {
  for (const box of children(b, start, end)) {
    if (box.type === 'udta') {
      const d = appleDate(b, box.from, box.to, now)
      if (d) return d
    }
    if (box.type !== 'meta') continue
    // QuickTime's 'meta' starts with its boxes; the ISO kind with 4 bytes first.
    const kids = children(b, type4(b, box.from + 4) === 'hdlr' ? box.from : box.from + 4, box.to)
    const keys = kids.find((k) => k.type === 'keys')
    const ilst = kids.find((k) => k.type === 'ilst')
    if (!keys || !ilst) continue
    const names: string[] = []
    let p = keys.from + 8
    for (let i = 0, n = u32(b, keys.from + 4); i < n && p + 8 <= keys.to; i++) {
      const size = u32(b, p)
      if (size < 8) break
      names.push(String.fromCharCode(...b.subarray(p + 8, Math.min(keys.to, p + size))))
      p += size
    }
    const want = names.indexOf(APPLE_DATE) + 1
    if (!want) continue
    const item = children(b, ilst.from, ilst.to).find((c) => u32(b, c.at + 4) === want)
    const data = item ? children(b, item.from, item.to).find((c) => c.type === 'data') : null
    if (!data || data.to - data.from <= 8) continue
    return filmedAtFromText(String.fromCharCode(...b.subarray(data.from + 8, data.to)), now)
  }
  return null
}

/** The facts of a video file, read from its movie box. Never throws: a file
 *  it cannot read gives no facts, and the batch pairs it another way. */
export async function readVideoFacts(file: Blob, now = Date.now()): Promise<VideoFacts> {
  try {
    const size = file.size
    let p = 0
    for (let n = 0; n < 64 && p + 8 <= size; n++) {
      const h = new Uint8Array(await file.slice(p, Math.min(size, p + 16)).arrayBuffer())
      let len = u32(h, 0)
      let head = 8
      if (len === 1) { len = u64(h, 8); head = 16 } else if (len === 0) len = size - p
      if (len < head) return { ...NO_FACTS }
      if (type4(h, 4) === 'moov') {
        const body = new Uint8Array(await file.slice(p + head, Math.min(p + len, p + head + MOOV_MAX)).arrayBuffer())
        return factsFromMoov(body, now)
      }
      p += len
    }
  } catch { /* not a file it can read */ }
  return { ...NO_FACTS }
}
