// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT'S TIKTOK DOWNLOAD AGAINST REAL TIKTOK, by hand (not a deploy check: it
// needs TikTok to answer). Loads a copy of extension/ into Chromium, grants
// www.tiktok.com up front (the Allow a creator presses), and runs SCOUT's own
// ttDownloadBounded on a public video, printing SCOUT's answer and Chrome's
// downloads list, and keeping the file as saved.mp4 next to the copy.
// Plain Chromium, nothing disguised; a TikTok check or refusal is reported as is.
//
//   node scripts/scout-tiktok-live.cjs [handle] [videoId]
//   VISIBLE=1 ...      from a TikTok tab in front (the creator's retry)
//   FORCE_PAGE=1 ...   Chrome's own downloads off, so the page way is used
//
// First run on 2026-11-10 (Seb: "get to the bottom of this fully"): both ways
// saved a 21 second H.264 and AAC file of @hankgreen1/video/7047596209028074758;
// v16 refused Chrome's own download (no page behind it), v19 gave it.
const { chromium } = require('playwright')
const fs = require('fs'); const path = require('path')
const SRC = path.join(__dirname, '..', 'extension')
const WORK = path.join(require('os').tmpdir(), 'scout-tiktok-live')
const EXT = path.join(WORK, 'ext')
const handle = process.argv[2] || 'hankgreen1'
const videoId = process.argv[3] || '7047596209028074758'
;(async () => {
  fs.rmSync(EXT, { recursive: true, force: true }); fs.cpSync(SRC, EXT, { recursive: true })
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
  m.host_permissions = [...m.host_permissions, 'https://www.tiktok.com/*']
  fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(m, null, 1))
  const userDir = path.join(WORK, 'profile'); fs.rmSync(userDir, { recursive: true, force: true })
  const ctx = await chromium.launchPersistentContext(userDir, { channel: 'chromium', headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] })
  let [sw] = ctx.serviceWorkers()
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 })
  console.log('SCOUT running', sw.url().split('/')[2].slice(0, 8))
  for (let i = 0; i < 40; i++) { try { if (await sw.evaluate(() => typeof ttDownloadBounded === 'function')) break } catch (e) {} await new Promise((r) => setTimeout(r, 500)) }
  ctx.on('download', (d) => console.log('BROWSER DOWNLOAD', d.suggestedFilename()))
  const t0 = Date.now()
  const poll = setInterval(async () => { try { const n = await sw.evaluate(() => ttDlNow && { step: ttDlNow.step, bytes: ttDlNow.bytes, total: ttDlNow.total, asking: ttDlNow.asking, tried: ttDlNow.tried.length }); console.log(`  t+${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(n)) } catch (e) {} }, 3000)
  if (process.env.FORCE_PAGE) await sw.evaluate(() => { const real = chrome.downloads.download.bind(chrome.downloads); chrome.downloads.download = (o) => /^https:/.test(o.url) ? Promise.reject(new Error('forced off for the test')) : real(o) })
  const r = await sw.evaluate(async ([h, id, VIS]) => await ttDownloadBounded({ handle: h, videoId: id, filename: 'probe-' + id, visible: VIS }), [handle, videoId, !!process.env.VISIBLE])
  clearInterval(poll)
  console.log('RESULT', JSON.stringify(r, null, 1))
  const items = await sw.evaluate(() => new Promise((res) => chrome.downloads.search({}, (l) => res(l.map((d) => ({ state: d.state, error: d.error, bytes: d.bytesReceived, total: d.totalBytes, file: d.filename, url: String(d.url).slice(0, 60) }))))))
  console.log('CHROME DOWNLOADS', JSON.stringify(items, null, 1))
  try { if (r.ok && r.file) { fs.copyFileSync(r.file, path.join(WORK, 'saved.mp4')); console.log('COPIED', fs.statSync(path.join(WORK, 'saved.mp4')).size) } } catch (e) { console.log('copy failed', e.message) }
  await ctx.close()
})().catch((e) => { console.error('FAILED', e.message); process.exit(1) })
