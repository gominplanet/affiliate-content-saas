// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AN IPHONE'S SPATIAL AUDIO DOES NOT STOP A RENDER (2026-11-12, Lisa's
// IMG_9223.mov on Drop: "The CTA could not be burned in after 3 tries ...
// ffmpeg: Could not find tag for codec none in stream #2, codec not currently
// supported in container. Could not write header for output file #0").
//
// An iPhone 16 records its sound twice: AAC, and Apple's spatial audio (APAC),
// which ffmpeg cannot read ("codec none" or "unknown"). The CTA burn mapped
// every audio track into the MP4 and failed on that one. This builds a file
// with the same layout (AAC, then a four channel track ffmpeg cannot name),
// shows the old burn failing with Lisa's words, and runs the video server's
// own functions (playableAudio, ffmpegRender, ffmpegRenderComplex) on it.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, execFileSync, spawnSync } = require('child_process')

const fails = []
const check = (name, ok, detail) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail).slice(0, 400)}` : ''}`) }
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')

function fnSource(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name} not found`)
  let depth = 0, i = src.indexOf('{', src.indexOf(')', start)), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  return src.slice(start, end)
}

// ── The code ────────────────────────────────────────────────────────────────
const cta = src.slice(src.indexOf("app.post('/render-cta'"), src.indexOf('function atempoChain('))
check('the CTA burn maps only the playable sound track, in both looks', /const audio = await playableAudio\(srcTmp\)/.test(cta) && (cta.match(/\.\.\.audioArgs/g) || []).length === 2 && !/'-map', '0:a\?'/.test(cta))
check('AAC is copied, any other playable sound made AAC, none left out', /audio\.codec === 'aac'/.test(cta) && /'-c:a', 'aac', '-b:a', '192k'/.test(cta) && /: \['-an'\]/.test(cta))
check('the clips map only the playable sound track too', /const audio = await playableAudio\(srcTmp\)/.test(src.slice(src.indexOf("app.post('/render-short'") - 6000)) && /ffmpegRender\(srcTmp, renderStart, dur, vf, outTmp, trim \? trim\.a : null, o\.timeoutMs, audio\)/.test(src) && !/trim \? '\[aout\]' : '0:a\?'/.test(src))

// ── A real file, where ffmpeg is installed ──────────────────────────────────
let ffmpeg = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { ffmpeg = false }

;(async () => {
  if (ffmpeg) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iphone-audio-'))
    const two = path.join(dir, 'two.mov')
    const iphone = path.join(dir, 'iphone.mov')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', '-ac:a:1', '4', '-y', two])
    // The second audio track becomes one ffmpeg cannot name: its sample entry
    // says apac and its AAC settings box is hidden, as on an iPhone 16.
    const b = fs.readFileSync(two)
    const at = []
    for (let i = b.indexOf('mp4a'); i >= 0; i = b.indexOf('mp4a', i + 1)) at.push(i)
    const second = at.filter((p) => p > at[0] + 200)
    for (const p of second) b.write('apac', p, 'latin1')
    const esds = b.indexOf('esds', second[0])
    if (esds > 0 && esds < second[0] + 400) b.write('xsds', esds, 'latin1')
    fs.writeFileSync(iphone, b)
    const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name', '-of', 'json', f]).toString()).streams
    const s = probe(iphone)
    check('the test file has the iPhone layout: AAC, then a sound track ffmpeg cannot name', s.length === 3 && s[1].codec_name === 'aac' && s[2].codec_type === 'audio' && !/^aac$/.test(String(s[2].codec_name || '')), s)

    // The burn as it was: Lisa's exact failure.
    const oldOut = path.join(dir, 'old.mp4')
    const old = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', iphone, '-f', 'lavfi', '-i', 'color=red:size=100x40', '-filter_complex', "[1:v]scale=100:40[st];[0:v][st]overlay=10:10[vout]", '-map', '[vout]', '-map', '0:a?', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy', '-y', oldOut])
    check('the burn as it was fails on this file with Lisa’s words', old.status !== 0 && /Could not find tag for codec none in stream #2/.test(String(old.stderr)), String(old.stderr))

    // The server's own functions.
    const sandbox = new Function('execFile', 'require', `${fnSource('playableAudio')}\n${fnSource('ffmpegRender')}\n${fnSource('ffmpegRenderComplex')}\nreturn { playableAudio, ffmpegRender, ffmpegRenderComplex }`)
    const S = sandbox(execFile, require)
    const audio = await S.playableAudio(iphone)
    check('the playable sound track is the AAC one', audio.map === '0:1' && audio.codec === 'aac', audio)

    // The CTA burn with a designed box, built as the server builds it.
    const audioArgs = audio.map ? ['-map', audio.map, ...(audio.codec === 'aac' || audio.codec === null ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'])] : ['-an']
    const ctaOut = path.join(dir, 'cta.mp4')
    const now = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', iphone, '-f', 'lavfi', '-i', 'color=red:size=100x40', '-filter_complex', "[1:v]scale=100:40[st];[0:v][st]overlay=10:10[vout]", '-map', '[vout]', ...audioArgs, '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart', '-y', ctaOut])
    const cs = now.status === 0 ? probe(ctaOut) : []
    check('the CTA burn now makes the video, with its sound', now.status === 0 && cs.length === 2 && cs[1].codec_name === 'aac', String(now.stderr) || cs)

    // A clip, plain and with silences cut, and a split screen.
    const clip = path.join(dir, 'clip.mp4')
    let err = null
    try { await S.ffmpegRender(iphone, 0, 2, 'scale=360:640', clip, null, 60000, audio) } catch (e) { err = e.message }
    check('a clip renders, with its sound', !err && probe(clip).length === 2, err)
    const cut = path.join(dir, 'cut.mp4')
    err = null
    try { await S.ffmpegRender(iphone, 0, 2, "select='lt(t,1)',setpts=N/FRAME_RATE/TB,scale=360:640", cut, "aselect='lt(t,1)',asetpts=N/SR/TB", 60000, audio) } catch (e) { err = e.message }
    check('a clip with silences cut renders, with its sound', !err && probe(cut).length === 2, err)
    const split = path.join(dir, 'split.mp4')
    err = null
    try { await S.ffmpegRenderComplex(iphone, 0, 2, '[0:v]scale=360:640[vout]', audio.map, split, false, 60000) } catch (e) { err = e.message }
    check('a split screen clip renders, with its sound', !err && probe(split).length === 2, err)

    // A video with no sound at all still renders.
    const mute = path.join(dir, 'mute.mp4')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '2', '-c:v', 'libx264', '-y', mute])
    const none = await S.playableAudio(mute)
    const muteOut = path.join(dir, 'mute-out.mp4')
    err = null
    try { await S.ffmpegRender(mute, 0, 1, 'scale=360:640', muteOut, null, 60000, none) } catch (e) { err = e.message }
    check('a video with no sound renders, without sound', none.map === null && !err && probe(muteOut).length === 1, err || none)
    fs.rmSync(dir, { recursive: true, force: true })
  }
  if (fails.length) {
    console.error(`❌ iphone-audio: ${fails.length} failure(s)`)
    for (const f of fails) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log(`✅ iphone-audio: an iPhone's spatial audio track no longer stops the CTA burn or the clips; only the playable sound track is used${ffmpeg ? '' : ' (no ffmpeg here: code checks only)'}`)
})()
