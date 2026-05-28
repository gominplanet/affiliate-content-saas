// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// YouTube storyboard frame extraction.
//
// YouTube serves "storyboards" for every video — the small preview tiles the
// scrubber bar uses. Each tile is a grid (usually 5×5) of 160×90 jpeg frames,
// sampled at ~1s intervals across the whole video. Stitched together they
// give us multiple real key frames from any public YouTube video without
// ffmpeg, yt-dlp, the browser extension, or any media work — just a few HTTP
// fetches and an image crop per frame.
//
// We use these as additional reference images for Nano Banana when the user
// hasn't captured frames via the extension (the extension is faster but not
// installed for everyone). Best-effort: YouTube blocks scrapers from some
// cloud IPs, so we return [] on any failure and the caller falls back to the
// existing maxres-thumbnail path.

import sharp from 'sharp'

/** A single frame extracted from a storyboard tile. */
export interface StoryboardFrame {
  /** Cropped JPEG bytes. */
  buffer: Buffer
  /** data: URL form, convenient for passing to the existing validFrames pool. */
  dataUrl: string
  /** Approximate timestamp (in seconds) within the source video. */
  timeSec: number
  width: number
  height: number
}

// Browser-like UA. YouTube blocks the obvious "fetch" UA from cloud IPs but
// is more permissive for browser-like requests.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

interface SpecLevel {
  width: number
  height: number
  count: number       // total frames in the video at this level
  cols: number        // columns per tile
  rows: number        // rows per tile
  intervalMs: number  // ms between consecutive frames
  filenamePattern: string  // e.g. "M$M.jpg" or "default"
  sig: string         // the sigh= signature this level requires
  levelIndex: number  // 0, 1, 2…
}

/**
 * Fetch up to `maxFrames` evenly-spaced storyboard frames for a YouTube video.
 * Returns [] on any failure (page blocked, no storyboard spec, malformed
 * response, etc.) so the caller can fall back gracefully.
 */
export async function fetchStoryboardFrames(
  videoId: string,
  opts?: { maxFrames?: number },
): Promise<StoryboardFrame[]> {
  if (!videoId || !/^[A-Za-z0-9_-]{6,15}$/.test(videoId)) return []
  const maxFrames = Math.max(1, Math.min(12, opts?.maxFrames ?? 4))

  try {
    // 1) Pull the watch page and find the storyboardSpec inside
    //    ytInitialPlayerResponse. YouTube embeds it as part of the player JSON.
    const html = await fetchWatchPageHtml(videoId)
    if (!html) return []

    const spec = extractStoryboardSpec(html)
    if (!spec) return []

    // 2) Parse the spec into levels and pick the highest-quality one we can
    //    actually fetch (largest width).
    const levels = parseSpec(spec)
    if (levels.length === 0) return []
    const level = levels.slice().sort((a, b) => b.width - a.width)[0]

    // 3) Pick evenly-spaced frame indices across the video.
    const frameIndices: number[] = []
    for (let i = 0; i < maxFrames; i++) {
      const t = (i + 0.5) / maxFrames
      frameIndices.push(Math.min(Math.floor(t * level.count), level.count - 1))
    }

    // 4) Group by tile, fetch each tile once, crop the requested frames out.
    const framesPerTile = level.cols * level.rows
    const byTile = new Map<number, number[]>()
    for (const fi of frameIndices) {
      const tileIdx = Math.floor(fi / framesPerTile)
      const arr = byTile.get(tileIdx) ?? []
      arr.push(fi)
      byTile.set(tileIdx, arr)
    }

    const out: StoryboardFrame[] = []
    for (const [tileIdx, fiList] of byTile.entries()) {
      const tileBuf = await fetchTile(spec.baseTemplate, level, tileIdx)
      if (!tileBuf) continue
      for (const fi of fiList) {
        const inTile = fi - tileIdx * framesPerTile
        const col = inTile % level.cols
        const row = Math.floor(inTile / level.cols)
        try {
          const cropped = await sharp(tileBuf)
            .extract({
              left: col * level.width,
              top: row * level.height,
              width: level.width,
              height: level.height,
            })
            .jpeg({ quality: 88 })
            .toBuffer()
          // Wrap in a plain Uint8Array so the resulting base64 string is built
          // from a real ArrayBuffer (sharp's Buffer is typed ArrayBufferLike).
          const bytes = new Uint8Array(cropped)
          const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
          out.push({
            buffer: cropped,
            dataUrl,
            timeSec: (fi * level.intervalMs) / 1000,
            width: level.width,
            height: level.height,
          })
        } catch {
          // skip a single bad crop; keep going
        }
      }
    }

    out.sort((a, b) => a.timeSec - b.timeSec)
    return out.slice(0, maxFrames)
  } catch {
    return []
  }
}

// ── internals ───────────────────────────────────────────────────────────────

async function fetchWatchPageHtml(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

interface ExtractedSpec {
  baseTemplate: string
  raw: string
}

/** Pull the storyboard spec string out of ytInitialPlayerResponse. */
function extractStoryboardSpec(html: string): ExtractedSpec | null {
  // The spec sits inside playerStoryboardSpecRenderer.spec. The string is
  // JSON-encoded so URL chars are escaped; un-escape them.
  const m = html.match(/"playerStoryboardSpecRenderer":\{"spec":"([^"]+)"/)
  if (!m) return null
  const raw = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\"/g, '"')
  // First pipe-delimited section is the base URL template. It contains $L
  // (level) and $M (tile index) placeholders.
  const baseTemplate = raw.split('|')[0]
  if (!baseTemplate || !baseTemplate.includes('$L')) return null
  return { baseTemplate, raw }
}

/** Parse the spec into one SpecLevel per quality level. */
function parseSpec(spec: ExtractedSpec): SpecLevel[] {
  const parts = spec.raw.split('|')
  const out: SpecLevel[] = []
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].split('#')
    if (seg.length < 8) continue
    const width = Number(seg[0])
    const height = Number(seg[1])
    const count = Number(seg[2])
    const cols = Number(seg[3])
    const rows = Number(seg[4])
    const intervalMs = Number(seg[5])
    const filenamePattern = seg[6]
    const sig = seg[7]
    if (![width, height, count, cols, rows, intervalMs].every(Number.isFinite)) continue
    if (count <= 0 || cols <= 0 || rows <= 0) continue
    out.push({ width, height, count, cols, rows, intervalMs, filenamePattern, sig, levelIndex: i - 1 })
  }
  return out
}

async function fetchTile(baseTemplate: string, level: SpecLevel, tileIdx: number): Promise<Buffer | null> {
  // The base template embeds the level segment "storyboard3_L$L" and the
  // tile segment "$M.jpg". Substitute both.
  let url = baseTemplate
    .replace('$L', String(level.levelIndex))
    .replace('$M', String(tileIdx))
  // Append the sigh signature this level requires (the tile won't serve
  // without it).
  url += (url.includes('?') ? '&' : '?') + `sigh=${level.sig}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  } catch {
    return null
  }
}
