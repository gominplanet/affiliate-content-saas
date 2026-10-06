// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// READING AN AMAZON LIVE REPLAY PAGE. Pure.
//
// The replay page carries everything Live follow-up needs in its own data,
// with no login: the trimmed replay stream (JSON-LD VideoObject.contentUrl,
// the same address as the POST_LIVE_TRIMMED variant's playbackUrl), Amazon's
// own captions for that stream (the variant's captionUrl, a WebVTT file), and
// the products shown, in order (the broadcast's carouselItems). Watching the
// player for the stream does not work: it loads the video inside a worker the
// page cannot see, which is why SCOUT reported "the video never started".

export type LiveReplayPage = {
  broadcastId: string
  title: string | null
  streamUrl: string | null
  captionUrl: string | null
  durationSec: number | null
  asins: string[]
}

/** The broadcast id in an amazon.com/live/broadcast/<id> link. */
export function broadcastIdOf(url: string): string | null {
  const m = /\/live\/broadcast\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(url || ''))
  return m ? m[1].toLowerCase() : null
}

/** The page's text with its JSON made readable: entities decoded (they are
 *  double encoded in places) and \" and \/ unescaped. */
export function normalizeLivePage(html: string): string {
  const decode = (s: string) => s
    .replace(/&#0*34;|&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return decode(decode(String(html || ''))).replace(/\\"/g, '"').replace(/\\\//g, '/')
}

function isoDurationSec(d: string | null | undefined): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(d || ''))
  if (!m) return null
  const s = (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)
  return s > 0 ? Math.round(s) : null
}

/** The array starting at `start` (its "["), by bracket counting. */
function arrayAt(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length && i < start + 200_000; i++) {
    const c = s[i]
    if (c === '[') depth++
    else if (c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1) }
  }
  return null
}

/** The {...} object that contains position `at`, by brace counting outward. */
function enclosingObject(s: string, at: number): string | null {
  let depth = 0
  let open = -1
  for (let i = at; i >= 0 && i > at - 300_000; i--) {
    const c = s[i]
    if (c === '}') depth++
    else if (c === '{') { if (depth === 0) { open = i; break } depth-- }
  }
  if (open < 0) return null
  depth = 0
  for (let i = open; i < s.length && i < open + 600_000; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return s.slice(open, i + 1) }
  }
  return null
}

export function parseLiveReplayHtml(html: string, broadcastId: string): LiveReplayPage {
  const s = normalizeLivePage(html)
  const id = broadcastId.toLowerCase()
  const out: LiveReplayPage = { broadcastId: id, title: null, streamUrl: null, captionUrl: null, durationSec: null, asins: [] }

  // The VideoObject for THIS broadcast (a page also lists other Lives).
  for (const m of s.matchAll(/"@type"\s*:\s*"VideoObject"[\s\S]{0,4000}?"contentUrl"\s*:\s*"(https:\/\/[^"]+?\.m3u8[^"]*)"/g)) {
    if (!m[1].toLowerCase().includes(id)) continue
    out.streamUrl = m[1]
    const block = s.slice(m.index ?? 0, (m.index ?? 0) + 6000)
    const name = /"name"\s*:\s*"([^"]+)"/.exec(block)?.[1] ?? null
    out.title = name ? name.replace(/^Watch\s+/i, '').replace(/\s+on Amazon Live$/i, '').trim() : null
    out.durationSec = isoDurationSec(/"duration"\s*:\s*"([^"]+)"/.exec(block)?.[1])
    break
  }
  // Failing that, any playback address for this broadcast.
  if (!out.streamUrl) {
    const m = new RegExp(`"(?:playbackUrl|hlsUrl)"\\s*:\\s*"(https:\\/\\/[^"]*${id}[^"]*\\.m3u8[^"]*)"`, 'i').exec(s)
    if (m) out.streamUrl = m[1]
  }

  // Amazon's captions for that same stream: the captionUrl beside its playbackUrl.
  if (out.streamUrl) {
    const at = s.indexOf(`"playbackUrl":"${out.streamUrl}"`)
    if (at >= 0) {
      const near = s.slice(Math.max(0, at - 800), at + 800)
      out.captionUrl = /"captionUrl"\s*:\s*"(https:\/\/[^"]+?\.vtt[^"]*)"/.exec(near)?.[1] ?? null
    }
  }

  // The products shown: the carouselItems list whose own object carries this
  // broadcast's "id" (a page also holds other Lives, each with its own list).
  const idKey = new RegExp(`"id"\\s*:\\s*"${id}"`)
  let best: { size: number; list: string } | null = null
  for (const m of s.matchAll(/"carouselItems"\s*:\s*\[/g)) {
    const start = (m.index ?? 0) + m[0].length - 1
    const obj = enclosingObject(s, m.index ?? 0)
    if (!obj || !idKey.test(obj)) continue
    const list = arrayAt(s, start)
    if (list && (!best || obj.length < best.size)) best = { size: obj.length, list }
  }
  if (best) {
    const seen = new Set<string>()
    for (const m of best.list.matchAll(/"type"\s*:\s*"PRODUCT"[^}]*?"asin"\s*:\s*"([A-Z0-9]{10})"/g)) {
      if (!seen.has(m[1])) { seen.add(m[1]); out.asins.push(m[1]) }
    }
  }
  if (!out.title) {
    const og = /<title>\s*Watch\s+([^<]+?)\s+on Amazon Live\s*<\/title>/i.exec(s)?.[1]
    out.title = og ? og.trim() : null
  }
  return out
}

/** A WebVTT file as word-timed cues: each caption's words spread evenly
 *  across its time, which is what the burned captions and the matcher use. */
export function vttToWordCues(vtt: string): Array<{ start: number; end: number; text: string }> {
  const t = (h: string | undefined, m: string, sec: string) => (Number(h || 0) * 3600) + (Number(m) * 60) + Number(sec)
  const out: Array<{ start: number; end: number; text: string }> = []
  const blocks = String(vtt || '').replace(/\r/g, '').split(/\n\n+/)
  for (const b of blocks) {
    const m = /(?:(\d+):)?(\d{2}):(\d{2}(?:\.\d+)?)\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2}(?:\.\d+)?)/.exec(b)
    if (!m) continue
    const start = t(m[1], m[2], m[3])
    const end = t(m[4], m[5], m[6])
    const text = b.slice(b.indexOf(m[0]) + m[0].length).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!text || !(end > start)) continue
    const words = text.split(' ')
    const step = (end - start) / words.length
    words.forEach((w, i) => out.push({ start: Math.round((start + i * step) * 1000) / 1000, end: Math.round((start + (i + 1) * step) * 1000) / 1000, text: w }))
  }
  return out
}
