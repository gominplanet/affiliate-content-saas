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

// ── THE FIVE CAPTION LOOKS (Seb, 2026-11-14) ────────────────────────────────
// Clip Factory offers Bold white, Yellow pop, Outline, Hype and Brand, and the
// choice never reached this server: every clip came out Bold white, and only
// the Cloudinary backup (switched off) ever drew the others. Each look is a
// libass style. Bold white is the look every clip has had, unchanged.
//   font      Anton (heavy, condensed) or Poppins ExtraBold (clean, rounded);
//             both are installed by the Dockerfile, DejaVu Sans if one is missing
//   box       an opaque box behind the line (libass BorderStyle 3)
//   upper     the words in capitals
//   active    the spoken word: its colour (null keeps the fill) and pop size
//   dim       the words not yet or no longer spoken, see-through (brand)
//   power     numbers, money and emphasis, coloured (null: not coloured)
//   margin    room left and right of the line (120 unless set: the wider
//             Poppins needs more of the width for three words)
const LOOKS = {
  'bold-white': { font: 'Anton', size: 108, fill: '#FFFFFF', edge: '#000000', edgeW: 8, shadow: 4, box: false, upper: true, words: 3, active: { color: '#FFFF00', pop: 118 }, power: '#33FF66', spacing: 2 },
  'yellow-pop': { font: 'Anton', size: 100, fill: '#FFD400', edge: '#111111', edgeW: 20, shadow: 0, box: true, upper: true, words: 3, active: { color: '#FFFFFF', pop: 114 }, power: '#33FF66', spacing: 2 },
  'outline': { font: 'Poppins ExtraBold', size: 98, fill: '#FFFFFF', edge: '#000000', edgeW: 9, shadow: 0, box: false, upper: false, words: 3, active: { color: null, pop: 112 }, power: null, spacing: 0, margin: 70 },
  'hype': { font: 'Anton', size: 128, fill: '#FFD400', edge: '#000000', edgeW: 10, shadow: 6, box: false, upper: true, words: 2, active: { color: '#FFFFFF', pop: 130 }, power: '#FF3B3B', spacing: 3 },
  'brand': { font: 'Poppins ExtraBold', size: 94, fill: null, edge: null, edgeW: 20, shadow: 0, box: true, upper: false, words: 3, active: { color: null, pop: 112 }, power: null, dim: true, spacing: 0, margin: 70 },
}
const DEFAULT_BRAND = '#7C3AED' // MVP's violet, when the creator saved no brand colour

/** '#RRGGBB' as libass writes it, &HAABBGGRR. */
function assColour(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  const h = (m ? m[1] : 'FFFFFF').toUpperCase()
  return `&H${alpha || '00'}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`
}
/** A clean '#RRGGBB', or null. */
function cleanHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  return m ? `#${m[1].toUpperCase()}` : null
}
/** Dark text on a light box, white text on a dark one. */
function textOn(hex) {
  const h = cleanHex(hex) || DEFAULT_BRAND
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#FFFFFF'
}

/** The look for a style name, with the creator's brand colour for Brand. */
function lookFor(style, brandColor) {
  const base = LOOKS[style] || LOOKS['bold-white']
  if (style !== 'brand') return base
  const box = cleanHex(brandColor) || DEFAULT_BRAND
  return { ...base, fill: textOn(box), edge: box }
}

function buildAss(cues, opts) {
  const o = opts || {}
  const L = lookFor(o.style, o.brandColor)
  const words = toWords(cues)
  const lines = groupLines(words, L.words, 0.6)
  const ACTIVE = L.active.color ? `${assColour(L.active.color)}&` : null
  const POWER = L.power ? `${assColour(L.power)}&` : null
  const brand = o.style === 'brand'
  // BorderStyle 1 is an outline round the letters; 3 is an opaque box, whose
  // colour libass takes from OutlineColour and whose padding is the Outline.
  const capStyle = `Style: Cap,${L.font},${L.size},${assColour(L.fill)},&H000000FF,${assColour(L.edge)},&H90000000,0,0,0,0,100,100,${L.spacing},0,${L.box ? 3 : 1},${L.edgeW},${L.shadow},2,${L.margin || 120},${L.margin || 120},520,1`
  // The hook card: black on yellow, or for Brand the creator's own colour.
  const hookStyle = brand
    ? `Style: Hook,${L.font},84,${assColour(L.fill)},&H000000FF,${assColour(L.edge)},&H00000000,0,0,0,0,100,100,0,0,3,22,0,8,90,90,300,1`
    : 'Style: Hook,Anton,92,&H00000000,&H000000FF,&H0000FFFF,&H00000000,0,0,0,0,100,100,1,0,3,22,0,8,90,90,300,1'

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
    capStyle,
    hookStyle,
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

  const pop = (n) => `\\fscx${n}\\fscy${n}\\t(0,90,\\fscx100\\fscy100)`
  const events = []
  for (let k = 0; k < seq.length; k++) {
    const cur = seq[k]
    const start = cur.start
    const next = seq[k + 1]
    const end = Math.max(start + 0.05, next ? next.start : cur.end)
    const text = cur.line.map((w, j) => {
      const t = L.upper ? w.text.toUpperCase() : w.text
      if (j === cur.i) return `{${ACTIVE ? `\\c${ACTIVE}` : ''}${pop(L.active.pop)}}${t}{\\r}`
      if (L.dim) return `{\\1a&H60&}${t}{\\r}`
      return w.hl && POWER ? `{\\c${POWER}}${t}{\\r}` : t
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

module.exports = { reframeChain, cropAt, buildAss, assTime, assEscape, toWords, keepSegments, trimFilters, HOOK_SEC, LOOKS, lookFor, assColour }
