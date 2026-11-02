// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEVERAL FILES, ONE VIDEO (Seb, 2026-11-02: "what if i have two files and
// they should be for the same video", "users should be able to let MVP
// know.. these files are for video #1"). The review editor's talking take,
// or its B-roll, can be several files joined in order. server.js downloads
// them; this joins them into one video on the timeline the sound was joined
// on (/stream-audio, edit-filters joinedAudioGraph), so a cut lands where its
// words are. Tested with real files in test-edit-filters.js.

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const { authArgs, concatList, joinAsIs, joinedOk, remakeSize, hdrChain, FPS } = require('./edit-filters')

/** A video's picture size as it plays (a phone's rotation applied), its
 *  length, and whether it has sound. */
function ffprobeInfo(input, auth = null) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', ...authArgs(auth), '-show_data_hash', 'CRC32', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels,extradata_hash,color_transfer:stream_tags=rotate:stream_side_data=rotation:format=duration', '-of', 'json', input],
      { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve(null)
        try {
          const j = JSON.parse(String(stdout))
          const streams = Array.isArray(j.streams) ? j.streams : []
          const v = streams.find((x) => x.codec_type === 'video') || {}
          const a = streams.find((x) => x.codec_type === 'audio') || {}
          const side = (Array.isArray(v.side_data_list) ? v.side_data_list : []).find((d) => d && d.rotation != null)
          const turn = Number(side ? side.rotation : (v.tags && v.tags.rotate)) || 0
          const rot = Math.abs(turn) % 180
          const w = Number(v.width) || 0, h = Number(v.height) || 0
          resolve({
            // How it was filmed, to the last setting: files with the same one
            // can be joined as they are (edit-filters joinAsIs).
            sig: [v.codec_name, w, h, turn, v.pix_fmt, v.r_frame_rate, v.color_transfer, v.extradata_hash, a.codec_name, a.sample_rate, a.channels, a.extradata_hash].map((x) => String(x ?? '')).join('|'),
            w: rot === 90 ? h : w, h: rot === 90 ? w : h,
            duration: Number(j.format && j.format.duration) || 0,
            hasAudio: streams.some((x) => x.codec_type === 'audio'),
            // HDR from a phone (edit-filters hdrChain): 'arib-std-b67' or 'smpte2084'.
            transfer: String(v.color_transfer || ''),
          })
        } catch { resolve(null) }
      })
  })
}

function run(args, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 1024 * 1024 * 64, timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, _so, se) => {
      if (err) reject(new Error(`${label}: ` + (((se && se.trim()) || err.message || 'failed') + (err.signal ? ` [signal ${err.signal}]` : '')).slice(-400)))
      else resolve()
    })
  })
}

/** Local files joined into one video at `${dir}/${name}.mp4`, in order.
 *  Files filmed the same way (edit-filters joinAsIs) are joined as they are,
 *  and the result is checked (joinedOk); files filmed differently, or a join
 *  that came out wrong, are made again at the first one's shape first
 *  (remakeSize; HDR converted when `tone`), so nothing is joined that would
 *  not play. Each file is deleted once joined. Answers the file, the length
 *  of each part and whether they had to be made again (`remade`). */
async function joinFiles({ files, dir, name, what = 'take', tone = false, threads = '2', onPct = () => {} }) {
  const file = path.join(dir, `${name}.mp4`)
  const infos = []
  for (const [i, f] of files.entries()) {
    const inf = await ffprobeInfo(f)
    if (!inf || !inf.w) throw new Error(`File ${i + 1} of the ${files.length} in your ${what} could not be read as a video.`)
    infos.push(inf)
  }
  const lengths = infos.map((x) => x.duration)
  const total = lengths.reduce((a, b) => a + b, 0)
  const join = async (list) => {
    const txt = path.join(dir, `${name}-files.txt`)
    fs.writeFileSync(txt, concatList(list, lengths))
    await run(['-f', 'concat', '-safe', '0', '-i', txt, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-y', file], 10 * 60_000, `joining your ${what}`)
    return ffprobeInfo(file)
  }
  let ok = false
  if (joinAsIs(infos)) {
    try { ok = joinedOk(await join(files), infos[0], total) } catch { ok = false }
  }
  if (!ok) {
    const size = remakeSize(infos[0].w, infos[0].h)
    const same = []
    for (const [i, f] of files.entries()) {
      onPct(Math.floor((i / files.length) * 100))
      const out = path.join(dir, `${name}-same${i}.mp4`)
      const hdr = tone ? hdrChain(infos[i].transfer) : null
      const silent = !infos[i].hasAudio
      await run(['-i', f, ...(silent ? ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'] : []),
        '-map', '0:v:0', '-map', silent ? '1:a:0' : '0:a:0', '-t', lengths[i].toFixed(3),
        '-vf', `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}${hdr ? `,${hdr}` : ',format=yuv420p'}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-pix_fmt', 'yuv420p', '-threads', String(threads),
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-af', 'apad', '-y', out], 20 * 60_000, `matching file ${i + 1} of your ${what}`)
      same.push(out)
    }
    const info = await join(same)
    if (!info || !info.w || Math.abs(info.duration - total) > Math.max(1, total * 0.01)) throw new Error(`The ${files.length} files of your ${what} could not be joined into one video.`)
    for (const f of same) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
  }
  for (const f of files) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
  onPct(100)
  return { file, lengths, remade: !ok }
}

module.exports = { ffprobeInfo, joinFiles }
