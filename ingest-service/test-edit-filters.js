// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The review editor's one pass (edit-filters.js). The timings are checked as
// numbers; then, where ffmpeg is installed, a made-up take (red, with sound)
// and B-roll (blue) are really edited, and the result is read back: its
// length, both formats, sound on both, and the B-roll showing exactly where
// it was placed and nowhere else.
const { execFileSync } = require('child_process')
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
  try {
    const main = path.join(dir, 'main.mp4'), broll = path.join(dir, 'broll.mp4'), logo = path.join(dir, 'logo.png')
    run(['-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', main])
    run(['-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=30:d=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', broll])
    run(['-f', 'lavfi', '-i', 'color=c=white:s=200x100', '-frames:v', '1', '-y', logo])
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
      zooms: [[0.5, 2.5]], color: true, logo: { input: 2, w: 200, h: 100, position: 'upper-left', widthPct: { wide: 0.1, vertical: 0.2 } },
    })
    fs.writeFileSync(path.join(dir, 'graph.txt'), built.graph)
    const out = { wide: path.join(dir, 'w.mp4'), vertical: path.join(dir, 'v.mp4') }
    const t0 = Date.now()
    run(['-i', main, '-i', path.join(dir, 'track.mp4'), '-i', logo, '-filter_complex_script', path.join(dir, 'graph.txt'),
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
    }
    console.log(`   (real edit of a 12 second take into two formats: ${secs.toFixed(1)}s)`)
  } catch (e) {
    fails.push(`the real edit failed: ${String(e.stderr || e.message).slice(0, 600)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
} else {
  console.log('   (ffmpeg not installed here: the real edit is skipped)')
}

if (fails.length) {
  console.error(`\n❌ edit-filters: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ edit-filters: cuts, B-roll, zooms, colour, logo and both formats in one pass, the B-roll exactly where it was placed')
