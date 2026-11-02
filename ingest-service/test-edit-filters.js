// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The review editor's one pass (edit-filters.js). The timings are checked as
// numbers; then, where ffmpeg is installed, a made-up take (red, with sound)
// and B-roll (blue) are really edited, and the result is read back: its
// length, both formats, sound on both, and the B-roll showing exactly where
// it was placed and nowhere else.
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const E = require('./edit-filters')

const fails = []
const check = (name, ok, detail) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

// ── Timings ──────────────────────────────────────────────────────────────────
const snap = E.snapSegments([[0, 2.01], [2.01, 3], [5.5, 9.02], [8, 10], [12, 12.02]])
check('touching parts join, overlaps start where the last ended, slivers go', JSON.stringify(snap.map((s) => [s.a, s.b])) === JSON.stringify([[0, 3], [5.5, 10]]), snap)
check('the length after cuts is whole frames', E.editSeconds(snap) === 7.5, E.editSeconds(snap))
check('each part knows where it lands', JSON.stringify(E.outputWindows(snap)) === JSON.stringify([{ start: 0, end: 3 }, { start: 3, end: 7.5 }]))
check('nothing to keep is null, never an empty video', E.snapSegments([]) === null && E.snapSegments([[3, 3.01]]) === null)

const ins = E.cleanInserts([{ at: 4, len: 3, from: 10 }, { at: 1, len: 2, from: 0 }, { at: 2, len: 5, from: 2 }, { at: 6.5, len: 9, from: 0 }], 7.5, 20)
check('B-roll moments are ordered, never overlap, and stay inside the video', JSON.stringify(ins) === JSON.stringify([{ at: 1, len: 2, from: 0 }, { at: 3, len: 4.5, from: 2 }]), ins)
check('cleaning a cleaned list changes nothing', JSON.stringify(E.cleanInserts(ins, 7.5, 20)) === JSON.stringify(ins))
check('a moment past the end of the B-roll is cut to what is there', E.cleanInserts([{ at: 0, len: 6, from: 17 }], 10, 20)[0].len === 3)
check('the track moves each piece to its moment', E.trackSetpts([{ at: 1, len: 2, from: 0 }, { at: 5, len: 1, from: 9 }]) === 'T+if(lt(T,2),1,3)')
check('slow zooms need a second and a half, and never overlap', JSON.stringify(E.cleanZooms([[1, 2], [2, 6], [5, 8], [9, 30]], 12)) === JSON.stringify([[2, 6], [9, 12]]))
check('a sideways take is put together at 1080, or 1440 when a vertical version is cut from it', JSON.stringify(E.masterSize(3840, 2160, false)) === JSON.stringify({ w: 1920, h: 1080, upright: false }) && E.masterSize(3840, 2160, true).h === 1440 && E.masterSize(1920, 1080, true).h === 1080)
check('an upright take is vertical only', E.masterSize(1080, 1920, false).upright === true)
let refused = ''
try { E.buildEditGraph({ segments: [[0, 5]], srcW: 1080, srcH: 1920, formats: ['wide'] }) } catch (e) { refused = e.message }
check('asking an upright take for the wide version says why it cannot', /vertical version only/.test(refused), refused)
const both = E.buildEditGraph({ segments: [[0, 5], [6, 8]], srcW: 1920, srcH: 1080, hasAudio: true, formats: ['wide', 'vertical'], zooms: [[0, 3]], color: true })
check('both formats come out of one graph, each with its own sound', both.outputs.wide && both.outputs.vertical && both.outputs.wide.a !== both.outputs.vertical.a && /split=2/.test(both.graph) && /asplit=2/.test(both.graph))
check('colour and zoom go in once, before the formats split', both.graph.indexOf('eq=') < both.graph.indexOf('split=2') && both.graph.indexOf('zoompan') < both.graph.indexOf('split=2'))
check('a take with no sound still gets a sound track', /anullsrc/.test(E.buildEditGraph({ segments: [[0, 5]], srcW: 1920, srcH: 1080, hasAudio: false, formats: ['wide'] }).graph))

// ── The creator's pictures (Seb, 2026-10-30: "add things to the screen by uploads, like PNGs") ──
{
  const pic = (i, extra) => ({ input: i, w: 100, h: 100, position: 'lower-right', widthPct: { wide: 0.2, vertical: 0.4 }, ...extra })
  const g = E.buildEditGraph({
    segments: [[0, 10]], srcW: 1920, srcH: 1080, hasAudio: true, formats: ['wide'],
    logo: { input: 1, w: 100, h: 50, position: 'upper-left', widthPct: { wide: 0.1, vertical: 0.2 } },
    title: { input: 2, w: 400, h: 80, position: 'top', startSec: 0.3, endSec: 4.3, widthPct: { wide: 0.3, vertical: 0.45 } },
    pictures: [pic(3, { startSec: 6, endSec: 8.5 }), pic(4, { position: 'center', opacity: 0.5 }), pic(5, {}), pic(6, {}), pic(7, {})],
  }).graph
  check('a picture with a moment shows only then', /\[3:v\]scale=384:384\[pc0wides\]/.test(g) && /overlay=1459:642:enable='between\(t,6,8\.5\)'\[pc0wideo\]/.test(g), g)
  const pc1 = g.split(';').find((l) => l.includes('[pc1wideo]')) || ''
  check('a picture for the whole video has no moment, and a see-through one keeps its own transparency', !!pc1 && !/enable/.test(pc1) && /\[4:v\]scale=384:384,format=rgba,colorchannelmixer=aa=0\.5/.test(g), pc1)
  check('pictures go under the logo and the title, so a big one never hides them', g.indexOf('[pc0wideo]') < g.indexOf('[lgwideo]') && g.indexOf('[lgwideo]') < g.indexOf('[ttwideo]'))
  check('four pictures at most', /pc3wideo/.test(g) && !/pc4wide/.test(g))
}

// ── The logo for the whole video, the first or the last seconds ─────────────
{
  const logo = (extra) => ({ input: 1, w: 100, h: 50, position: 'upper-left', widthPct: { wide: 0.1, vertical: 0.2 }, ...extra })
  const line = (g) => g.split(';').find((l) => l.includes('[lgwideo]')) || ''
  const whole = E.buildEditGraph({ segments: [[0, 20]], srcW: 1920, srcH: 1080, hasAudio: true, formats: ['wide'], logo: logo({}) }).graph
  const first = E.buildEditGraph({ segments: [[0, 20]], srcW: 1920, srcH: 1080, hasAudio: true, formats: ['wide'], logo: logo({ startSec: 0, endSec: 5 }) }).graph
  check('a logo on the whole video has no timing; the first five seconds is timed', !/enable/.test(line(whole)) && /enable='between\(t,0,5\)'/.test(line(first)), [line(whole), line(first)])
}

// ── When each clip was filmed, from the file itself ─────────────────────────
check('an iPhone\u2019s own date wins, with its time zone', E.filmedAtFrom({ 'com.apple.quicktime.creationdate': '2026-10-30T14:22:33-0400', creation_time: '2026-10-30T18:22:40.000000Z' }) === '2026-10-30T18:22:33.000Z')
check('else the file\u2019s creation time', E.filmedAtFrom({ creation_time: '2026-10-30T18:22:40.000000Z' }) === '2026-10-30T18:22:40.000Z')
check('a clock never set, a date to come, or no date at all is not a filming time', E.filmedAtFrom({ creation_time: '1970-01-01T00:00:00.000000Z' }) === null && E.filmedAtFrom({ creation_time: '1904-01-01T00:00:00Z' }) === null && E.filmedAtFrom({ creation_time: '2099-01-01T00:00:00Z' }) === null && E.filmedAtFrom({}) === null && E.filmedAtFrom(null) === null)

// ── iPhone HDR takes are brought to normal colour ────────────────────────────
check('HDR (HLG or PQ) gets the conversion, a normal take none', !!E.hdrChain('arib-std-b67') && /tin=smpte2084/.test(E.hdrChain('smpte2084')) && E.hdrChain('') === null && E.hdrChain('bt709') === null)
{
  const plain = E.buildEditGraph({ segments: [[0, 5]], srcW: 1920, srcH: 1080, hasAudio: true, formats: ['wide'] })
  const hdr = E.buildEditGraph({ segments: [[0, 5]], srcW: 3840, srcH: 2160, hasAudio: true, formats: ['wide'], transfer: 'arib-std-b67' })
  check('the conversion runs after the picture is made small, on the take only', !plain.hdr && !/zscale/.test(plain.graph) && hdr.hdr && /crop=1920:1080,setsar=1,zscale=tin=arib-std-b67/.test(hdr.graph))
}

// ── A Drive token only ever goes to Google's Drive ───────────────────────────
{
  const tok = 'Bearer ya29.' + 'a'.repeat(40)
  check('a Drive take gets the token', E.driveAuth('https://www.googleapis.com/drive/v3/files/abc?alt=media', tok) === tok)
  check('any other address never does', [
    'https://evil.example/drive/v3/files/abc', 'http://www.googleapis.com/drive/v3/files/abc', 'https://www.googleapis.com/youtube/v3/x',
    'https://www.googleapis.com.evil.example/drive/v3/files/abc', 'https://x.supabase.co/storage/v1/object/public/instagram-videos/u/a.mp4',
  ].every((u) => E.driveAuth(u, tok) === null))
  check('something that is not a token is never passed on', E.driveAuth('https://www.googleapis.com/drive/v3/files/abc', 'Bearer x\r\nX-Evil: 1') === null && E.driveAuth('https://www.googleapis.com/drive/v3/files/abc', '') === null)
  check('ffmpeg gets the token as a header only when there is one', E.authArgs(null).length === 0 && E.authArgs(tok)[0] === '-headers')
}

// ── The server's own files are in its image ──────────────────────────────────
// The Dockerfile copies named files. A file server.js requires that is not
// copied crashes the video server on start, and every render with it.
{
  const docker = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8')
  const copied = new Set((docker.match(/^COPY\s+(.+?)\s+\.\/\s*$/gm) || []).flatMap((l) => l.replace(/^COPY\s+/, '').replace(/\s+\.\/\s*$/, '').split(/\s+/)))
  const needed = Array.from(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').matchAll(/require\('\.\/([^']+)'\)/g)).map((m) => m[1].endsWith('.js') ? m[1] : `${m[1]}.js`)
  const missing = needed.filter((f) => !copied.has(f))
  check('every file server.js needs is copied into the image', missing.length === 0 && needed.length > 0, missing)
}

// ── A real edit, where ffmpeg is installed ───────────────────────────────────
let ffmpeg = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { ffmpeg = false }
if (ffmpeg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'))
  const run = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f]).toString())
  // Mean colour of one frame at `at` seconds: [r, g, b].
  const rgbAt = (f, at) => {
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', f, '-frames:v', '1', '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const c = [0, 0, 0]
    for (let i = 0; i < raw.length; i += 3) { c[0] += raw[i]; c[1] += raw[i + 1]; c[2] += raw[i + 2] }
    return c.map((x) => Math.round(x / (raw.length / 3)))
  }
  // Mean colour of a small box of one frame.
  const rgbIn = (f, at, x, y, w, h) => {
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', f, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const c = [0, 0, 0]
    for (let i = 0; i < raw.length; i += 3) { c[0] += raw[i]; c[1] += raw[i + 1]; c[2] += raw[i + 2] }
    return c.map((v) => Math.round(v / (raw.length / 3)))
  }
  try {
    const main = path.join(dir, 'main.mp4'), broll = path.join(dir, 'broll.mp4'), logo = path.join(dir, 'logo.png'), sticker = path.join(dir, 'sticker.png')
    run(['-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', main])
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=30:d=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', broll])
    run(['-f', 'lavfi', '-i', 'color=c=white:s=200x100', '-frames:v', '1', '-y', logo])
    run(['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=100x100', '-frames:v', '1', '-y', sticker])
    const segments = [[0, 3], [4, 7], [8, 11]] // 9 seconds kept
    const inserts = E.cleanInserts([{ at: 4, len: 2, from: 1 }], 9, 8)
    // The B-roll track, as server.js makes it.
    const m = E.masterSize(1280, 720, true)
    const piece = path.join(dir, 'piece0.mp4')
    run(['-ss', String(inserts[0].from), '-i', broll, '-an', '-vf', `setpts=PTS-STARTPTS,fps=30,scale=${m.w}:${m.h}:force_original_aspect_ratio=increase,crop=${m.w}:${m.h},setsar=1`, '-frames:v', String(Math.round(inserts[0].len * 30)), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', piece])
    fs.writeFileSync(path.join(dir, 'pieces.txt'), `file '${piece}'`)
    run(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'pieces.txt'), '-c', 'copy', '-y', path.join(dir, 'track.mp4')])
    const built = E.buildEditGraph({
      segments, srcW: 1280, srcH: 720, hasAudio: true, formats: ['wide', 'vertical'], inserts, brollSec: 8, track: 1,
      zooms: [[0.5, 2.5]], color: true, logo: { input: 2, w: 200, h: 100, position: 'upper-left', widthPct: { wide: 0.1, vertical: 0.2 }, opacity: 0.5 },
      pictures: [{ input: 3, w: 100, h: 100, position: 'lower-right', widthPct: { wide: 0.2, vertical: 0.3 }, startSec: 6.5, endSec: 8.5 }],
    })
    fs.writeFileSync(path.join(dir, 'graph.txt'), built.graph)
    const out = { wide: path.join(dir, 'w.mp4'), vertical: path.join(dir, 'v.mp4') }
    const t0 = Date.now()
    run(['-i', main, '-i', path.join(dir, 'track.mp4'), '-i', logo, '-i', sticker, '-filter_complex_script', path.join(dir, 'graph.txt'),
      ...['wide', 'vertical'].flatMap((f) => ['-map', `[${built.outputs[f].v}]`, '-map', `[${built.outputs[f].a}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', out[f]])])
    const secs = (Date.now() - t0) / 1000
    for (const f of ['wide', 'vertical']) {
      const p = probe(out[f])
      const v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio')
      const dur = Number(p.format.duration)
      check(`${f}: 9 seconds after the cuts`, Math.abs(dur - 9) < 0.15, dur)
      check(`${f}: the right shape`, f === 'wide' ? v.width === 1920 && v.height === 1080 : v.width === 1080 && v.height === 1920, [v.width, v.height])
      check(`${f}: has sound`, !!a)
      const talk = rgbAt(out[f], 2.5), br = rgbAt(out[f], 5), after = rgbAt(out[f], 7.5)
      check(`${f}: the take shows before the B-roll`, talk[0] > 150 && talk[2] < 90, talk)
      check(`${f}: the B-roll shows at its moment`, br[2] > 150 && br[0] < 90, br)
      check(`${f}: the take comes back after it`, after[0] > 150 && after[2] < 90, after)
      // The logo (white, at 50%) over the red take, top left: pink, not white, not red.
      const W = f === 'wide' ? 1920 : 1080
      const stamp = rgbIn(out[f], 1.5, Math.round(W * 0.04) + 8, Math.round((f === 'wide' ? 1080 : 1920) * 0.05) + 8, 24, 16)
      check(`${f}: the logo is a see-through stamp in its corner`, stamp[0] > 200 && stamp[1] > 90 && stamp[1] < 190 && stamp[2] > 90 && stamp[2] < 190, stamp)
      // The green picture, bottom right, from 6.5 to 8.5 seconds only.
      const H = f === 'wide' ? 1080 : 1920
      const corner = (t) => rgbIn(out[f], t, W - Math.round(W * 0.04) - 40, H - Math.round(H * 0.05) - 40, 24, 24)
      const before = corner(3.5), during = corner(7.5)
      check(`${f}: a picture shows at its moment, in its corner`, during[1] > 200 && during[0] < 60, during)
      check(`${f}: and not before it`, before[1] < 60, before)
    }
    console.log(`   (real edit of a 12 second take into two formats: ${secs.toFixed(1)}s)`)
    // A filming time written by a camera is read back the way /filmed reads it.
    const stamped = path.join(dir, 'stamped.mov')
    run(['-i', main, '-c', 'copy', '-metadata', 'creation_time=2026-10-30T18:22:40Z', '-y', stamped])
    const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', stamped]).toString()).format.tags
    check('the filming time a camera wrote is read from the file', E.filmedAtFrom(tags) === '2026-10-30T18:22:40.000Z', tags)
  } catch (e) {
    fails.push(`the real edit failed: ${String(e.stderr || e.message).slice(0, 600)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
} else {
  console.log('   (ffmpeg not installed here: the real edit is skipped)')
}

// ── Several files, one video (join-takes; Seb, 2026-11-02: "these files are
// for video #1") ───────────────────────────────────────────────────────────
{
  const tok = 'Bearer ya29.' + 'a'.repeat(40)
  const drive = 'https://www.googleapis.com/drive/v3/files/abc?alt=media'
  const one = E.takeParts(undefined, 'https://x.supabase.co/a.mp4', null)
  check('one file is a take of one part', one && one.length === 1 && one[0].url === 'https://x.supabase.co/a.mp4' && one[0].auth === null)
  const two = E.takeParts([{ url: drive, auth: tok }, { url: 'https://x.supabase.co/b.mp4', auth: tok }])
  check('several files keep their order, and a token only goes with a Drive file', two && two.length === 2 && two[0].auth === tok && two[1].auth === null)
  check('too many files, none, or one that is not https is refused, never made from fewer', E.takeParts(Array.from({ length: E.MAX_PARTS + 1 }, () => ({ url: drive }))) === null && E.takeParts([], '', null) === null && E.takeParts([{ url: drive }, { url: 'http://x/a.mp4' }]) === null)
  check('each file starts where the one before ends', JSON.stringify(E.partStarts([2, 3, 1.5])) === JSON.stringify([0, 2, 5]))
  check('a moment of the joined take is found in its file', JSON.stringify(E.partAt([2, 3], 2.5)) === JSON.stringify({ i: 1, at: 0.5 }) && JSON.stringify(E.partAt([2, 3], 1)) === JSON.stringify({ i: 0, at: 1 }) && E.partAt([2, 3], 9).i === 1)
  check('the join list gives each file its length, and a quote in a name cannot break it', E.concatList(['/t/a.mov', "/t/it's.mov"], [2, 3.25]) === "file '/t/a.mov'\nduration 2.000\nfile '/t/it'\\''s.mov'\nduration 3.250\n")
  const g = E.joinedAudioGraph([2, 3])
  check('the joined sound pads or trims each file to its length, then plays them in order', /\[0:a:0\][^;]*apad,atrim=end=2\.000\[a0\]/.test(g) && /\[1:a:0\][^;]*atrim=end=3\.000\[a1\]/.test(g) && /\[a0\]\[a1\]concat=n=2:v=0:a=1\[a\]$/.test(g), g)
  check('files filmed the same way are joined as they are; any difference means made again', E.joinAsIs([{ sig: 'x' }, { sig: 'x' }]) && !E.joinAsIs([{ sig: 'x' }, { sig: 'y' }]) && !E.joinAsIs([{ sig: 'x' }]) && !E.joinAsIs([{ sig: '' }, { sig: '' }]))
  check('files made again keep the first one’s shape, no bigger than the edit uses', JSON.stringify(E.remakeSize(3840, 2160)) === JSON.stringify({ w: 2560, h: 1440 }) && JSON.stringify(E.remakeSize(2160, 3840)) === JSON.stringify({ w: 1080, h: 1920 }) && JSON.stringify(E.remakeSize(640, 360)) === JSON.stringify({ w: 640, h: 360 }))
  check('a joined file is right only when it plays like the first and is as long as all', E.joinedOk({ w: 360, h: 640, hasAudio: true, duration: 5.02 }, { w: 360, h: 640, hasAudio: true }, 5) && !E.joinedOk({ w: 640, h: 360, hasAudio: true, duration: 5 }, { w: 360, h: 640, hasAudio: true }, 5) && !E.joinedOk({ w: 360, h: 640, hasAudio: true, duration: 2 }, { w: 360, h: 640, hasAudio: true }, 5))
}

/** Two files really joined: as they are when filmed the same way (an
 *  upright phone take stays upright), made again when not, and the sound
 *  joined on the same timeline, so the second file's words start where its
 *  picture does even when the first file's sound is shorter than its picture. */
async function joinTest() {
  const { joinFiles, ffprobeInfo } = require('./join-takes')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'join-test-'))
  const run = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  const rgbAt = (f, at) => {
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', f, '-frames:v', '1', '-vf', 'scale=8:8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const c = [0, 0, 0]
    for (let i = 0; i < raw.length; i += 3) { c[0] += raw[i]; c[1] += raw[i + 1]; c[2] += raw[i + 2] }
    return c.map((x) => Math.round(x / (raw.length / 3)))
  }
  // Where the quiet at the start ends: where the second file's sound begins.
  const soundStarts = (f) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' })
    const m = /silence_end:\s*([\d.]+)/.exec(String(r.stderr || ''))
    return m ? Number(m[1]) : null
  }
  try {
    const take = (file, color, size, secs, sound) => run(['-f', 'lavfi', '-i', `color=c=${color}:s=${size}:r=30:d=${secs}`, '-f', 'lavfi', '-i', sound,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-y', file])
    // The first file: 2 seconds of picture, 1.6 of quiet sound. The second: 3 seconds with a tone.
    take(path.join(dir, 'a.mp4'), 'red', '640x360', 2, 'anullsrc=r=48000:cl=mono:d=1.6')
    take(path.join(dir, 'b.mp4'), 'blue', '640x360', 3, 'sine=f=440:r=48000:d=3')
    take(path.join(dir, 'c.mp4'), 'green', '1280x720', 2, 'sine=f=660:r=48000:d=2')
    // Filmed upright on a phone: the picture is stored sideways and turned.
    run(['-display_rotation', '90', '-i', path.join(dir, 'a.mp4'), '-c', 'copy', '-y', path.join(dir, 'a.mov')])
    run(['-display_rotation', '90', '-i', path.join(dir, 'b.mp4'), '-c', 'copy', '-y', path.join(dir, 'b.mov')])
    const lengths = [(await ffprobeInfo(path.join(dir, 'a.mov'))).duration, (await ffprobeInfo(path.join(dir, 'b.mov'))).duration]

    // The sound, as /stream-audio joins it.
    const wavs = ['a.mov', 'b.mov'].map((f, i) => { const w = path.join(dir, `s${i}.wav`); run(['-i', path.join(dir, f), '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', w]); return w })
    const heard = path.join(dir, 'heard.m4a')
    run([...wavs.flatMap((w) => ['-i', w]), '-filter_complex', E.joinedAudioGraph(lengths), '-map', '[a]', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '32k', '-y', heard])
    const heardInfo = await ffprobeInfo(heard)
    check('the joined sound is as long as both files', Math.abs(heardInfo.duration - 5) < 0.1, heardInfo.duration)
    const s1 = soundStarts(heard)
    check('the second file’s sound starts at 2 seconds, where its picture does, though the first file’s sound stops at 1.6', s1 != null && Math.abs(s1 - 2) < 0.08, s1)

    // Filmed the same way: joined as they are, still upright.
    const same = await joinFiles({ files: [path.join(dir, 'a.mov'), path.join(dir, 'b.mov')], dir, name: 'same' })
    const si = await ffprobeInfo(same.file)
    check('two files filmed the same way are joined as they are', same.remade === false, same)
    check('an upright phone take stays upright when joined', si.w === 360 && si.h === 640, si)
    check('the joined video is as long as both', Math.abs(si.duration - 5) < 0.1, si.duration)
    const red = rgbAt(same.file, 1), blue = rgbAt(same.file, 3)
    check('the first file plays first and the second after it', red[0] > 180 && red[2] < 80 && blue[2] > 180 && blue[0] < 80, { red, blue })
    const s2 = soundStarts(same.file)
    check('in the joined video the second file’s sound starts at 2 seconds too, so the cuts land on the words', s2 != null && Math.abs(s2 - 2) < 0.08, s2)
    check('the files are deleted once joined', !fs.existsSync(path.join(dir, 'a.mov')) && !fs.existsSync(path.join(dir, 'b.mov')))

    // Filmed differently (another size): the second is made again to match.
    const mixed = await joinFiles({ files: [path.join(dir, 'a.mp4'), path.join(dir, 'c.mp4')], dir, name: 'mixed' })
    const mi = await ffprobeInfo(mixed.file)
    check('files filmed differently are made again before they are joined', mixed.remade === true)
    check('they come out at the first file’s shape and as long as both', mi.w === 640 && mi.h === 360 && Math.abs(mi.duration - 4) < 0.15, mi)
    const green = rgbAt(mixed.file, 3)
    check('the second file is there after the first', green[1] > 100 && green[0] < 60 && green[2] < 60, green)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// Every file server.js needs is in the video server's image.
{
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')
  const docker = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8')
  const local = [...server.matchAll(/require\('\.\/([\w-]+)'\)/g)].map((m) => `${m[1]}.js`)
  const copied = (/^COPY server\.js (.+) \.\/$/m.exec(docker) || [])[1] || ''
  check('every file server.js needs is copied into the video server', local.length >= 3 && local.every((f) => copied.split(/\s+/).includes(f)), { local, copied })
}

;(ffmpeg ? joinTest() : Promise.resolve()).catch((e) => { fails.push(`the real join failed: ${String(e.stderr || e.message).slice(0, 600)}`) }).then(() => {
  if (fails.length) {
    console.error(`\n❌ edit-filters: ${fails.length} failure(s)\n`)
    for (const f of fails) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ edit-filters: cuts, B-roll, zooms, colour, logo, pictures and both formats in one pass, the B-roll and pictures exactly where they were placed; several files joined into one take on the timeline its sound was read on')
})
