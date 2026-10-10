// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Pure helpers for the render-short pipeline: the FFmpeg reframe filtergraph.
 * Split out of server.js so it can be unit-tested directly
 * (test-render-filters.js) without spinning up the service or ffmpeg.
 */

// Build the video reframe sub-chain from an input label to [vout], optionally
// burning captions. mode:
//   'center' — center-crop fill to W x H.
//   'split'  — SEAMLESS split: the bottom shows the full 16:9 frame at its
//              natural height, the top is a center-crop zoom filling the rest.
//              No letterbox bars (top+bottom heights sum to H exactly).
// cropX (optional, 0 to 1): where the crop window sits across the frame, 0 the
// left edge, 1 the right. Unset keeps the exact centre, as before.
function cropAt(cropX) {
  const x = Number(cropX)
  return Number.isFinite(x) && x >= 0 && x <= 1 ? `:(iw-ow)*${Math.round(x * 1000) / 1000}:(ih-oh)/2` : ''
}
function reframeChain(inLabel, mode, W, H, assPath, cropX) {
  const cap = assPath ? `,ass=${assPath}` : ''
  const at = cropAt(cropX)
  if (mode === 'split') {
    const bottomH = 2 * Math.round((W * 9 / 16) / 2) // full 16:9 frame at width W
    const topH = H - bottomH                          // zoom crop fills the remainder
    return (
      `${inLabel}split=2[sa][sb];` +
      `[sa]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH}${at}[stop];` +
      `[sb]scale=${W}:${bottomH}[sbot];` +
      `[stop][sbot]vstack=inputs=2${cap}[vout]`
    )
  }
  return `${inLabel}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${at}${cap}[vout]`
}


// ── Hormozi-style captions (FFmpeg + libass) ────────────────────────────────
// Word-by-word: 1–3 words on screen, the ACTIVE word pops (scale bounce) and
// turns yellow as it's spoken. Rendered as an ASS subtitle burned by ffmpeg,
// which is what the good caption tools do — Cloudinary's static text can't.

function assTime(sec) {
  let s = Number(sec)
  if (!Number.isFinite(s) || s < 0) s = 0
  const cs = Math.round(s * 100)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const ss = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

// Strip ASS-special chars so a stray brace/backslash can't break the subtitle.
function assEscape(t) {
  return String(t == null ? '' : t).replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim()
}

// Normalize incoming cues to per-WORD timing. Single-word cues (Whisper
// word-level) pass through with real timings; multi-word cues (phrase-level
// source) are split evenly across their span so we still get word animation.
function toWords(cues) {
  const out = []
  for (const c of Array.isArray(cues) ? cues : []) {
    const start = Number(c && (c.startSec != null ? c.startSec : c.start))
    let end = Number(c && (c.endSec != null ? c.endSec : c.end))
    const text = assEscape(c && c.text)
    if (!text || !Number.isFinite(start)) continue
    if (!Number.isFinite(end) || end <= start) end = start + 0.4
    const toks = text.split(/\s+/).filter(Boolean)
    const hl = !!(c && c.hl)
    if (toks.length <= 1) { out.push({ start, end, text: toks[0] || text, hl }); continue }
    const per = (end - start) / toks.length
    // A phrase flagged as a whole: only its numbers and money carry the colour.
    toks.forEach((w, i) => out.push({ start: start + i * per, end: start + (i + 1) * per, text: w, hl: hl && /[\d$%]/.test(w) }))
  }
  return out.sort((a, b) => a.start - b.start)
}

// Group words into short lines (<=maxWords, break on a speech pause or sentence).
function groupLines(words, maxWords, gap) {
  const lines = []
  let cur = []
  const flush = () => { if (cur.length) { lines.push(cur); cur = [] } }
  for (const w of words) {
    if (cur.length) {
      const g = w.start - cur[cur.length - 1].end
      if (cur.length >= maxWords || g > gap || /[.!?]$/.test(cur[cur.length - 1].text)) flush()
    }
    cur.push(w)
  }
  flush()
  return lines
}

// THE HOOK CARD (Seb, 2026-10-10): the planner writes every clip a hook, and
// it was never shown. It now opens the clip for HOOK_SEC: black text on a
// yellow box near the top, clear of the captions at the bottom.
const HOOK_SEC = 2.4
function hookEvent(hook) {
  const t = assEscape(hook).toUpperCase().slice(0, 60)
  if (!t) return null
  return `Dialogue: 1,${assTime(0)},${assTime(HOOK_SEC)},Hook,,0,0,0,,{\\fad(120,250)}${t}`
}

function buildAss(cues, opts) {
  const o = opts || {}
  const words = toWords(cues)
  const lines = groupLines(words, 3, 0.6)
  const HIGHLIGHT = '&H0000FFFF&' // yellow, ASS is &HBBGGRR
  // Power words (numbers, money, emphasis) the render route flags with hl, in
  // green, so they stand out before and after they are spoken. The flag used
  // to be sent and never read.
  const POWER = '&H0066FF33&'

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 1',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Anton 108, white fill, black outline 8 + shadow 4, bottom-center, MarginV 520.
    'Style: Cap,Anton,108,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,0,0,0,0,100,100,2,0,1,8,4,2,120,120,520,1',
    // Hook: black Anton on an opaque yellow box (BorderStyle 3), top centre.
    'Style: Hook,Anton,92,&H00000000,&H000000FF,&H0000FFFF,&H00000000,0,0,0,0,100,100,1,0,3,22,0,8,90,90,300,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  // Flatten to ONE global, time-ordered sequence (each word tagged with its
  // line). Building events per-line let a line's last word hold to its own end,
  // which (a) left a gap before the next line → flicker, and (b) could overlap
  // the next line when Whisper word times cross → two lines stacked ("stepping
  // over each other"). Here every word event ends exactly when the NEXT word
  // starts, so the track is gap-free and never overlaps.
  const seq = []
  for (const line of lines) for (let i = 0; i < line.length; i++) seq.push({ line, i, start: line[i].start, end: line[i].end })
  seq.sort((a, b) => a.start - b.start)

  const events = []
  for (let k = 0; k < seq.length; k++) {
    const cur = seq[k]
    const start = cur.start
    const next = seq[k + 1]
    const end = Math.max(start + 0.05, next ? next.start : cur.end)
    const text = cur.line.map((w, j) => {
      const up = w.text.toUpperCase()
      if (j === cur.i) return `{\\c${HIGHLIGHT}\\fscx118\\fscy118\\t(0,90,\\fscx100\\fscy100)}${up}{\\r}`
      return w.hl ? `{\\c${POWER}}${up}{\\r}` : up
    }).join(' ')
    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${text}`)
  }
  const hook = o.hook ? hookEvent(o.hook) : null
  if (hook) events.unshift(hook)
  return `${header}\n${events.join('\n')}\n`
}

// ── Trim silences ──────────────────────────────────────────────────────────
// The render route sends the stretches of the clip to KEEP (clip-relative
// seconds, from lib/shorts-snap silenceCuts) and caption words already moved
// onto the shortened timeline. A select/aselect pair drops everything else.

/** Clean, ordered keep-segments inside [0, dur], or null when there is nothing
 *  to cut (fewer than two segments). */
function keepSegments(raw, dur) {
  if (!Array.isArray(raw)) return null
  const out = []
  for (const seg of raw.slice(0, 80)) {
    const a = Number(seg && seg[0])
    const b = Number(seg && seg[1])
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a < 0) continue
    const s = Math.round(a * 100) / 100
    const e = Math.round(Math.min(b, dur) * 100) / 100
    if (e <= s) continue
    if (out.length && s < out[out.length - 1][1]) return null // overlapping: not trusted
    out.push([s, e])
  }
  return out.length >= 2 ? out : null
}

/** The video and audio filters that keep only those segments, retimed to run
 *  back to back. Quoted so the commas inside between() stay inside the filter. */
function trimFilters(segments) {
  const keep = segments.map(([a, b]) => `between(t,${a},${b})`).join('+')
  return {
    v: `select='${keep}',setpts=N/FRAME_RATE/TB`,
    a: `aselect='${keep}',asetpts=N/SR/TB`,
    seconds: Math.round(segments.reduce((n, [a, b]) => n + (b - a), 0) * 100) / 100,
  }
}

module.exports = { reframeChain, cropAt, buildAss, assTime, assEscape, toWords, keepSegments, trimFilters, HOOK_SEC }
