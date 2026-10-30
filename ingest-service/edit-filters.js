// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S ONE PASS (Seb, 2026-10-30: "shoot in one go your video
// review, and then the next file, shoot all of the B-roll ... MVP can use
// those two files to make a proper video review"). Everything an edit asks
// for is one ffmpeg run, so a video is decoded once and encoded once per
// format, which is what keeps it fast and cheap at 200 videos a month:
//   the kept parts of the take, back to back (cuts);
//   B-roll laid over the talk at its moments, the talk's sound underneath;
//   slow push-in zooms; a colour boost;
//   then per format (wide for Amazon and YouTube, vertical for TRYBE and
//   TikTok): the logo, the title, and on vertical the captions.
// Pure: builds the filter graph and its timings; server.js runs it. Tested in
// ingest-service/test-edit-filters.js, including a real render of made-up
// clips when ffmpeg is installed.

const FPS = 30
/** Audio is cut in 1ms steps (asetnsamples), so the sound stays on the
 *  picture over hundreds of cuts. */
const AUDIO_STEP = 48

const r3 = (n) => Math.round(n * 1000) / 1000

/** The parts of the take to keep, on the frame grid: [a, b) in seconds and
 *  as frame numbers, ordered, not overlapping, each at least two frames.
 *  Null when nothing usable is left. */
function snapSegments(raw, maxSec) {
  const out = []
  for (const seg of Array.isArray(raw) ? raw.slice(0, 400) : []) {
    let ka = Math.round(Number(seg && seg[0]) * FPS)
    let kb = Math.round(Math.min(Number(seg && seg[1]), Number.isFinite(maxSec) ? maxSec : Infinity) * FPS)
    if (!Number.isFinite(ka) || !Number.isFinite(kb)) continue
    ka = Math.max(0, ka)
    const prev = out[out.length - 1]
    if (prev && ka < prev.kb) ka = prev.kb // overlap: start where the last one ended
    if (kb - ka < 2) continue
    if (prev && ka === prev.kb) { prev.kb = kb; prev.b = r3(kb / FPS); continue } // touching: one part
    out.push({ ka, kb, a: r3(ka / FPS), b: r3(kb / FPS) })
  }
  return out.length ? out : null
}

/** Seconds of video after the cuts. */
function editSeconds(snapped) {
  return r3(snapped.reduce((n, s) => n + (s.kb - s.ka), 0) / FPS)
}

/** Where each kept part lands in the finished video: [start, end) seconds. */
function outputWindows(snapped) {
  let k = 0
  return snapped.map((s) => { const w = { start: r3(k / FPS), end: r3((k + s.kb - s.ka) / FPS) }; k += s.kb - s.ka; return w })
}

const videoKeep = (snapped) => snapped.map((s) => `between(n,${s.ka},${s.kb - 1})`).join('+')
const audioKeep = (snapped) => snapped.map((s) => `gte(t,${s.a})*lt(t,${s.b})`).join('+')

/** B-roll moments, cleaned: inside the video, not overlapping, at most 24,
 *  each 1 to 8 seconds. at = seconds into the finished video, from = seconds
 *  into the B-roll take. */
function cleanInserts(raw, totalSec, brollSec) {
  const list = (Array.isArray(raw) ? raw : [])
    .map((x) => ({ at: Number(x && x.at), len: Number(x && x.len), from: Number(x && x.from) }))
    .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.len) && Number.isFinite(x.from) && x.at >= 0 && x.from >= 0)
    .sort((p, q) => p.at - q.at)
  const out = []
  for (const x of list) {
    if (out.length >= 24) break
    const prev = out[out.length - 1]
    const at = r3(Math.max(x.at, prev ? prev.at + prev.len : 0))
    let len = Math.min(8, x.len, totalSec - at, Number.isFinite(brollSec) ? brollSec - x.from : Infinity)
    // Whole frames, and the same answer when an already cleaned list is cleaned again.
    len = Math.floor(len * FPS + 0.01) / FPS
    if (len < 1) continue
    out.push({ at, len: r3(len), from: r3(x.from) })
  }
  return out
}

/** The B-roll track holds the pieces back to back; this moves each piece to
 *  its moment in the finished video. T is seconds into the track. */
function trackSetpts(inserts) {
  let start = 0
  const parts = inserts.map((x) => { const p = { s: start, shift: r3(x.at - start) }; start = r3(start + x.len); return p })
  let expr = `${parts[parts.length - 1].shift}`
  for (let i = parts.length - 2; i >= 0; i--) expr = `if(lt(T,${parts[i + 1].s}),${parts[i].shift},${expr})`
  return `T+${expr}`
}
const insertEnable = (inserts) => inserts.map((x) => `between(t,${x.at},${r3(x.at + x.len - 0.001)})`).join('+')

/** Slow push-in on each window (seconds into the finished video): eases to
 *  ZOOM_IN over the first 1.5 seconds, holds, and eases back over the last
 *  0.35 (Seb, 2026-10-30: the 7% ones were too slight to see). */
const ZOOM_IN = 0.12
function zoomExpr(zooms) {
  const T = `on/${FPS}`
  const terms = zooms.map(([a, b]) => `between(${T},${a},${b})*min(1,(${T}-${a})/1.5)*min(1,(${b}-${T})/0.35)`)
  return `1+${ZOOM_IN}*(${terms.join('+')})`
}
function cleanZooms(raw, totalSec) {
  const out = []
  for (const z of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    const a = r3(Number(z && z[0])), b = r3(Math.min(Number(z && z[1]), totalSec))
    if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 1.5) continue // too short to see
    if (out.length && a < out[out.length - 1][1]) continue
    out.push([a, b])
  }
  return out
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2)

/** IPHONE HDR (Seb, 2026-10-30, an iPhone 18 Pro take): phones film HDR by
 *  default (HLG, or PQ), and HDR shown as an ordinary video looks grey and
 *  washed out. Such a take is brought to normal colour (tone mapped to
 *  BT.709) after it is made small, so the heavy part runs on fewer pixels.
 *  The transfer is named, so it works whatever tags survive the resize.
 *  Null for a normal take. Pure. */
function hdrChain(transfer) {
  const tin = transfer === 'arib-std-b67' ? 'arib-std-b67' : transfer === 'smpte2084' ? 'smpte2084' : null
  if (!tin) return null
  return `zscale=tin=${tin}:pin=bt2020:min=bt2020nc:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`
}

/** The size everything is put together at, before each format is made.
 *  Sideways takes: 16:9, 1080 tall, or 1440 when a vertical version is cut
 *  from it so that one stays sharp. Upright takes: 1080x1920, vertical only. */
function masterSize(srcW, srcH, wantVertical) {
  if (!(srcW > 0 && srcH > 0) || srcW >= srcH) {
    const h = Math.min(wantVertical ? 1440 : 1080, Math.max(720, srcH || 1080))
    return { w: even(h * 16 / 9), h: even(h), upright: false }
  }
  return { w: 1080, h: 1920, upright: true }
}

/** Top-left of a w x h overlay on a W x H frame, by name (server.js
 *  overlayXY's names). */
function placeAt(position, W, H, w, h) {
  const mx = Math.round(W * 0.04), my = Math.round(H * 0.05)
  switch (position) {
    case 'upper-left': return { x: mx, y: my }
    case 'upper-right': return { x: W - w - mx, y: my }
    case 'top': return { x: Math.round((W - w) / 2), y: my }
    case 'center': return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) }
    case 'lower-left': return { x: mx, y: H - h - my }
    case 'lower-right': return { x: W - w - mx, y: H - h - my }
    case 'bottom': default: return { x: Math.round((W - w) / 2), y: H - h - my }
  }
}

/**
 * The whole edit as one filter graph.
 * opts: {
 *   segments,                      kept parts of the take (seconds)
 *   srcW, srcH, hasAudio,          the take's picture as played (rotation applied), and whether it has sound
 *   transfer,                      its colour transfer: 'arib-std-b67' or 'smpte2084' is HDR (hdrChain)
 *   formats: ['wide'|'vertical'],
 *   cropX,                         0 left to 1 right, where vertical is cut from a sideways take
 *   inserts, brollSec, track,      track: input index of the B-roll track (pieces back to back)
 *   zooms, color,
 *   logo: { input, w, h, position, widthPct: { wide, vertical }, opacity? (0 to 1) },
 *   title: { input, w, h, position, startSec, endSec, widthPct: { wide, vertical } },
 *   ass,                           captions file (vertical only)
 * }
 * Returns { graph, outputs: { wide?: { v, a }, vertical?: { v, a } }, seconds, inserts, zooms }.
 */
function buildEditGraph(opts) {
  const o = opts || {}
  const snapped = snapSegments(o.segments)
  if (!snapped) throw Object.assign(new Error('nothing to keep'), { status: 400 })
  const seconds = editSeconds(snapped)
  const wantVertical = (o.formats || []).includes('vertical')
  const m = masterSize(o.srcW, o.srcH, wantVertical)
  const formats = (o.formats || []).filter((f) => f === 'vertical' || (f === 'wide' && !m.upright))
  if (!formats.length) throw Object.assign(new Error(m.upright ? 'An upright take makes the vertical version only.' : 'no format'), { status: 400 })
  const inserts = Number.isInteger(o.track) ? cleanInserts(o.inserts, seconds, o.brollSec) : []
  const zooms = cleanZooms(o.zooms, seconds)

  const g = []
  // The take: constant 30 frames a second, the kept frames only, at the master size.
  const hdr = hdrChain(o.transfer)
  g.push(`[0:v]setpts=PTS-STARTPTS,fps=${FPS},select='${videoKeep(snapped)}',setpts=N/${FPS}/TB,scale=${m.w}:${m.h}:force_original_aspect_ratio=increase,crop=${m.w}:${m.h},setsar=1${hdr ? `,${hdr}` : ''}[m0]`)
  // A take with no sound gets silence, so every output still has a sound track.
  g.push(o.hasAudio === false
    ? `anullsrc=r=48000:cl=stereo,atrim=0:${seconds}[a0]`
    : `[0:a]asetpts=PTS-STARTPTS,aresample=48000,asetnsamples=n=${AUDIO_STEP}:p=0,aselect='${audioKeep(snapped)}',asetpts=N/SR/TB[a0]`)
  let v = 'm0'
  if (zooms.length) {
    g.push(`[${v}]zoompan=z='${zoomExpr(zooms)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${m.w}x${m.h}:fps=${FPS}[mz]`)
    v = 'mz'
  }
  if (inserts.length) {
    // The B-roll track is already in normal colour (server.js cuts its
    // pieces with the same conversion when the B-roll take is HDR).
    g.push(`[${o.track}:v]setpts='(${trackSetpts(inserts)})/TB',scale=${m.w}:${m.h}:force_original_aspect_ratio=increase,crop=${m.w}:${m.h},setsar=1[br]`)
    g.push(`[${v}][br]overlay=0:0:enable='${insertEnable(inserts)}':eof_action=pass:repeatlast=0[mb]`)
    v = 'mb'
  }
  if (o.color) {
    g.push(`[${v}]eq=contrast=1.06:saturation=1.18:brightness=0.01[mc]`)
    v = 'mc'
  }
  const two = formats.length === 2
  if (two) {
    g.push(`[${v}]split=2[fw][fv]`)
    g.push(`[a0]asplit=2[aw][av]`)
  }
  const lab = { wide: two ? 'fw' : v, vertical: two ? 'fv' : v }
  const alab = { wide: two ? 'aw' : 'a0', vertical: two ? 'av' : 'a0' }
  // An overlay used by both formats is split once.
  const pngIn = (spec, name) => {
    if (!spec) return {}
    if (!two) return { wide: `${spec.input}:v`, vertical: `${spec.input}:v` }
    g.push(`[${spec.input}:v]split=2[${name}w][${name}v]`)
    return { wide: `${name}w`, vertical: `${name}v` }
  }
  const logoIn = pngIn(o.logo, 'lg')
  const titleIn = pngIn(o.title, 'tt')

  const outputs = {}
  for (const f of formats) {
    const W = f === 'wide' ? 1920 : 1080
    const H = f === 'wide' ? 1080 : 1920
    let cur = `${f}0`
    if (f === 'wide') g.push(`[${lab.wide}]scale=${W}:${H}[${cur}]`)
    else if (m.upright) g.push(`[${lab.vertical}]scale=${W}:${H}[${cur}]`)
    else {
      // The upright window across the sideways picture; cropX 0.5 is the middle.
      const cw = even(m.h * 9 / 16)
      const x = Math.round((m.w - cw) * Math.min(1, Math.max(0, Number.isFinite(Number(o.cropX)) ? Number(o.cropX) : 0.5)))
      g.push(`[${lab.vertical}]crop=${cw}:${m.h}:${x}:0,scale=${W}:${H}[${cur}]`)
    }
    const put = (spec, input, name, timed) => {
      if (!spec) return
      const pct = Math.min(0.9, Math.max(0.05, Number(spec.widthPct && spec.widthPct[f]) || (f === 'wide' ? 0.12 : 0.22)))
      const w = even(W * pct)
      const h = even(w * (spec.h > 0 && spec.w > 0 ? spec.h / spec.w : 1))
      const { x, y } = placeAt(spec.position, W, H, w, h)
      const sized = `${name}${f}s`
      // A see-through stamp (Seb, 2026-10-30: "a 50% transparency stamp"):
      // the picture's own transparency kept, times the opacity asked for.
      const op = Number(spec.opacity)
      const fade = Number.isFinite(op) && op > 0 && op < 1 ? `,format=rgba,colorchannelmixer=aa=${Math.round(op * 100) / 100}` : ''
      g.push(`[${input}]scale=${w}:${h}${fade}[${sized}]`)
      const next = `${name}${f}o`
      const when = timed ? `:enable='between(t,${r3(spec.startSec)},${r3(spec.endSec)})'` : ''
      g.push(`[${cur}][${sized}]overlay=${x}:${y}${when}[${next}]`)
      cur = next
    }
    put(o.logo, logoIn[f], 'lg', false)
    put(o.title, titleIn[f], 'tt', true)
    if (f === 'vertical' && o.ass) {
      g.push(`[${cur}]ass=${o.ass}[${f}c]`)
      cur = `${f}c`
    }
    outputs[f] = { v: cur, a: alab[f] }
  }
  return { graph: g.join(';\n'), outputs, seconds, inserts, zooms, master: m, formats, hdr: !!hdr }
}

/** A creator's Google Drive token, only when the address is Google's Drive
 *  and the token looks like one: never sent anywhere else. */
function driveAuth(url, auth) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && u.hostname === 'www.googleapis.com' && u.pathname.startsWith('/drive/') && /^Bearer [\w.\-~+/=]{20,}$/.test(String(auth || '')) ? String(auth) : null
  } catch { return null }
}
/** ffmpeg and ffprobe read a Drive file with the token as a header. */
const authArgs = (auth) => (auth ? ['-headers', `Authorization: ${auth}\r\n`] : [])

// ── Dead air (Seb, 2026-10-30: "there's still a lot of dead air instead of
// cutting straight into the next sentence") ───────────────────────────────
// Word timings from speech to text stretch a word's end into the silence
// after it, so pauses hide inside them. The sound itself says where it is
// quiet: silencedetect, with a threshold set from how loud this take is.

/** The quiet level for a take: 14 dB under its average loudness, kept
 *  between -50 and -30 dB so a hiss or a whisper never decides it. */
function silenceNoiseDb(meanDb) {
  const m = Number(meanDb)
  return Number.isFinite(m) ? Math.round(Math.min(-30, Math.max(-50, m - 14))) : -40
}

/** silencedetect's lines as [start, end] seconds, in order. A silence still
 *  open at the end of the take ends at `duration`. */
function parseSilences(stderr, duration) {
  const out = []
  let open = null
  for (const line of String(stderr || '').split('\n')) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (a) { open = Math.max(0, Number(a[1])); continue }
    const b = /silence_end:\s*([\d.]+)/.exec(line)
    if (b && open != null) { out.push([r3(open), r3(Number(b[1]))]); open = null }
  }
  if (open != null && Number.isFinite(Number(duration)) && Number(duration) > open) out.push([r3(open), r3(Number(duration))])
  return out.filter(([x, y]) => y > x)
}

/** The mean loudness volumedetect reports, in dB, or null. */
function parseMeanDb(stderr) {
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(String(stderr || ''))
  return m ? Number(m[1]) : null
}

module.exports = { silenceNoiseDb, parseSilences, parseMeanDb, hdrChain, driveAuth, authArgs, FPS, snapSegments, editSeconds, outputWindows, cleanInserts, trackSetpts, insertEnable, zoomExpr, cleanZooms, masterSize, placeAt, buildEditGraph }
