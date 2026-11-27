// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// CLIP FIRST (Seb, 2026-11-27: "start the faster clip first method. So we can
// render faster"). A Video Builder set's hooks, bodies and CTAs are each
// edited once, as a clip (server.js /render-edit with clip: true), and every
// video is its clips joined one after another here (server.js
// /assemble-edit), instead of being made again from the start.
//
// The join, measured (test-edit-filters.js): joining the files as they are,
// sound included, put the audio encoder's padding at every join, a 40 ms
// silence each time and the voice later after each one. So the pictures are
// joined as they are (when every clip was written the same way), each exactly
// its frames long, and the sound is read from each clip and made exactly as
// long as its picture. Picture and sound then join at the same moments.

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { clipsAudioGraph, clipList, musicChain, musicMix, FPS } = require('./edit-filters')

/** Every Video Builder clip's picture is written the same way, so clips join
 *  as they are (join-takes ffprobeInfo `sig` compares how each file was
 *  written, colour tags included: an HDR clip brought to normal colour is
 *  tagged as normal colour, like the rest). */
const CLIP_VIDEO_ARGS = ['-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

function run(args, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, _so, se) => {
      if (err) reject(new Error(`${label}: ` + (((se && se.trim()) || err.message || 'failed') + (err.signal ? ` [signal ${err.signal}]` : '')).slice(-400)))
      else resolve()
    })
  })
}

/** A clip's picture length in frames, from its header (counted when the
 *  header does not say). 0 when it cannot be read. */
function clipFrames(file) {
  const ask = (args) => new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', ...args, '-of', 'csv=p=0', file], { timeout: 60_000, killSignal: 'SIGKILL' }, (err, out) => {
      const n = Number(String(out || '').trim().split(/[\s,]+/)[0])
      resolve(!err && Number.isFinite(n) && n > 0 ? Math.round(n) : 0)
    })
  })
  return ask(['-show_entries', 'stream=nb_frames']).then((n) => n || ask(['-count_packets', '-show_entries', 'stream=nb_read_packets']))
}

/**
 * Clips joined into one video at `${work}/out.mp4`.
 *   clips: [{ file, frames, info: { sig } }] in order (each a finished clip)
 *   music: { file, volume } | null, looped under the whole video
 * Answers { file, seconds, remade (the pictures had to be made again to
 * join), mixed (the music is in) }.
 */
async function joinClips({ clips, music = null, work, threads = '2', onPct = () => {} }) {
  if (!Array.isArray(clips) || !clips.length) throw new Error('no clips to join')
  const frames = clips.map((c) => c.frames)
  const total = frames.reduce((a, b) => a + b, 0)
  const seconds = Math.round((total / FPS) * 1000) / 1000
  const picture = path.join(work, 'picture.mp4')
  const sameWay = clips.every((c) => c.info && c.info.sig && c.info.sig === clips[0].info.sig)
  let remade = !sameWay
  if (sameWay) {
    fs.writeFileSync(path.join(work, 'list.txt'), clipList(clips.map((c) => c.file), frames))
    try {
      await run(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-map', '0:v:0', '-c', 'copy', '-y', picture], 5 * 60_000, 'joining the clips')
      // Checked: as many frames as the clips have together, else made again.
      if (await clipFrames(picture) !== total) remade = true
    } catch { remade = true }
  }
  if (remade) {
    const each = clips.map((c, i) => `[${i}:v:0]setpts=PTS-STARTPTS,fps=${FPS},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,trim=end_frame=${c.frames}[v${i}]`)
    await run([...clips.flatMap((c) => ['-i', c.file]), '-filter_complex', `${each.join(';')};${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[v]`,
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', String(threads), ...CLIP_VIDEO_ARGS, '-y', picture], 10 * 60_000, 'making the clips the same')
  }
  onPct(60)
  const out = path.join(work, 'out.mp4')
  const sound = clipsAudioGraph(frames.map((f) => f / FPS), 1)
  const inputs = ['-i', picture, ...clips.flatMap((c) => ['-i', c.file])]
  if (music && music.file) {
    const graph = `${sound};${musicChain(clips.length + 1, seconds, music.volume)};${musicMix('aj', 2)}`
    await run([...inputs, '-stream_loop', '-1', '-i', music.file, '-filter_complex', graph, '-map', '0:v:0', '-map', '[amx]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', String(seconds), '-movflags', '+faststart', '-y', out], 5 * 60_000, 'the music')
  } else {
    await run([...inputs, '-filter_complex', sound, '-map', '0:v:0', '-map', '[aj]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-y', out], 5 * 60_000, 'the sound')
  }
  onPct(95)
  return { file: out, seconds, remade, mixed: !!(music && music.file) }
}

module.exports = { CLIP_VIDEO_ARGS, clipFrames, joinClips }
