// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT'S TIKTOK DOWNLOAD, RUN (extension/background.js, 1.60.6; Seb,
// 2026-11-09: the download on 1.60.0 and again on 1.60.1 ended in "took too
// long", with nothing said about where it stuck). The download code itself is
// run here against a pretend Chrome and a pretend TikTok page, with its time
// limits shortened, in the ways it went wrong or could:
//
//   the page's own read goes first (1.60.5), slow but moving: saved, from the
//     page, and Chrome's own download is never tried
//   the page stops answering (Seb's 1.60.4: "page-busy"): said with how Chrome
//     held the tab, and Chrome's own download, slow but moving the whole time,
//     is followed to the end, never cut off at a fixed time
//   Chrome's own download brings a web page, not the video (Seb's Downloads on
//     1.60.4 held two 300 KB "vigority...mp4" pages): deleted, never kept
//   Chrome asks where to save: waited for, said, and saved once answered
//   a file smaller than TikTok says the video is (Seb's on 1.60.5 played 2
//     seconds and froze): deleted, never kept as the video
//   the TikTok tab closes part way (Seb's visible try: "No tab with id"): said
//   TikTok's page never answers SCOUT: stopped at the limit, and the answer
//     says which step it reached (1.60.1 said only "took too long")
//   TikTok stops sending part way: not saved, with how much had come in
//   the video's page gives no address (Seb's try on 1.60.2): found in the
//     profile's own video grid, scrolled until it comes, and saved
//   neither gives one: said, with what the page and the profile showed
//   a photo post (1.60.4): said, nothing tried
//   a status TikTok gave instead of the video: said with its code
// and the page reading itself, on a page shaped like TikTok's (tested against
// real TikTok on 2026-11-10): H.264 first, bytevc2 left out, www.tiktok.com
// addresses last, its "Please wait..." check and photo posts told apart.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }

const B = readFileSync('extension/background.js', 'utf8')
const from = B.indexOf('// ── MATCH MY TIKTOK: DOWNLOAD A VIDEO (1.60.0 to 1.60.6)')
const to = B.indexOf('let ttDlBusy = Promise.resolve()')
check('the download section is where this check looks for it', from > 0 && to > from)
let sec = B.slice(from, to)
// Limits shortened so each case takes a few seconds.
const short: Array<[string, string]> = [
  ['const TT_DL_MAX_MS = 270000', 'const TT_DL_MAX_MS = 6000'],
  ['const TT_DL_STALL_MS = 20000', 'const TT_DL_STALL_MS = 1200'],
  ['const TT_DL_ASK_MS = 120000', 'const TT_DL_ASK_MS = 3000'],
  ['Date.now() - began > 4000', 'Date.now() - began > 500'],
]
for (const [a, b] of short) { check(`the limit is where this check shortens it: ${a}`, sec.includes(a)); sec = sec.replace(a, b) }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// A download in the pretend Chrome: `rate` bytes a look, up to `size`;
// refused at once; asking where to save for its first `askLooks` looks; or
// stopping after `stopAfter` looks.
function item(o: { size?: number; rate?: number; refuse?: string; askLooks?: number; stopAfter?: number; mime?: string } = {}) {
  const size = o.size ?? 5e6
  const rate = o.rate ?? 1e6
  let got = 0
  let looks = 0
  return {
    cancelled: false,
    look(this: { cancelled: boolean }) {
      looks++
      if (o.refuse) return { state: 'interrupted', error: o.refuse, bytesReceived: 0, totalBytes: 0, filename: '' }
      if (this.cancelled) return { state: 'interrupted', error: 'USER_CANCELED', bytesReceived: got, totalBytes: size, filename: '' }
      if (o.stopAfter == null || looks < o.stopAfter) got = Math.min(size, got + rate)
      const asking = looks <= (o.askLooks ?? 0)
      const whole = got >= size && !asking
      return { state: whole ? 'complete' : 'in_progress', bytesReceived: got, totalBytes: size, fileSize: whole ? size : 0, filename: asking ? '' : '/Downloads/vigority.mp4', mime: o.mime ?? 'video/mp4' }
    },
  }
}
const URLS = () => ({ urls: [{ url: 'https://v16-webapp-prime.tiktok.com/a', from: 'bitrate' }, { url: 'https://v19-webapp-prime.tiktok.com/b', from: 'bitrate' }, { url: 'https://www.tiktok.com/aweme/v1/play/c', from: 'bitrate' }], found: true })
// As TikTok's page gives them since 1.60.6: each version's exact size, and the length.
const SIZED = () => ({ urls: [{ url: 'https://v16-webapp-prime.tiktok.com/a', from: 'bitrate', size: 4533599, q: 'h264_720p' }, { url: 'https://v19-webapp-prime.tiktok.com/b', from: 'bitrate', size: 4533599, q: 'h264_720p' }, { url: 'https://v16-webapp-prime.tiktok.com/c', from: 'bitrate', size: 1596825, q: 'h264_540p' }], found: true, dur: 38 })
// The page's own read, whole after `ms`.
const pageRead = (ms: number, size = 4e6) => () => { const t0 = Date.now(); return { state: async () => { const p = Math.min(1, (Date.now() - t0) / ms); return { bytes: Math.round(size * p), total: size, done: p >= 1, ok: p >= 1, error: null, still: 0 } } } }
// The page that does not answer SCOUT at all (Seb's Chrome on 1.60.4).
const pageBusy = () => { throw new Error('page-busy') }

interface Case { urls: () => Any; chromeDl: () => Any; page?: (args: Any[]) => Any; blobDl?: () => Any; windows: string[]; grid?: (scrolls: number) => Any
  /** A longer whole limit, for a case that also reads the profile. */
  max?: number
  /** How Chrome holds SCOUT's tab. */
  tab?: Any
  /** Files Chrome was told to delete. */
  removed?: number[]
  /** Close the tab after this many asks of the page. */
  closeAfter?: number }
function scout(c: Case) {
  const dls: Record<number, Any> = {}
  let next = 1
  const created: Array<(i: Any) => void> = []
  const chrome = {
    runtime: {},
    downloads: {
      download: async () => { const id = next++; dls[id] = c.chromeDl(); return id },
      search: ({ id }: { id: number }, cb: (r: Any[]) => void) => { const d = dls[id]; cb(d ? [d.look()] : []) },
      cancel: (id: number, cb?: () => void) => { if (dls[id]) dls[id].cancelled = true; if (cb) cb() },
      erase: () => {},
      removeFile: (id: number, cb?: () => void) => { if (c.removed) c.removed.push(id); if (cb) cb() },
      onCreated: { addListener: (f: Any) => created.push(f), removeListener: (f: Any) => { const i = created.indexOf(f); if (i >= 0) created.splice(i, 1) } },
    },
    tabs: { get: async () => ({ windowId: 9, ...(c.tab || {}) }), remove: async () => {}, update: async () => ({}),
      onRemoved: { addListener: (f: Any) => removedFns.push(f), removeListener: () => {} }, onReplaced: { addListener: () => {}, removeListener: () => {} } },
    scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    windows: { get: async () => ({ state: 'minimized' }), update: async (_id: number, o: { state: string }) => { c.windows.push(o.state) } },
  }
  let save: Any = null
  let scrolls = 0
  let asks = 0
  const removedFns: Array<(id: number, info: Any) => void> = []
  const trybeRun = async (func: Any, args: Any[]) => {
    if (c.closeAfter != null && ++asks > c.closeAfter) { for (const f of removedFns) f(5, { isWindowClosing: false }); throw new Error('No tab with id: 5.') }
    if (func.name === 'ttVideoUrlsInPage') return c.urls()
    if (func.name === 'ttItemUrlsInPage') return c.grid ? c.grid(scrolls) : { found: false, urls: [], have: 0, hasMore: false, hooked: true }
    if (func.name === 'ttScrollInPage') { scrolls++; return 1 }
    if (func.name === 'ttPageSaveStartInPage') { save = (c.page || pageBusy)(args); return true }
    if (func.name === 'ttPageSaveStateInPage') {
      const s = await save.state()
      // The page saving its finished file starts a download of a blob address.
      if (s && s.done && s.ok && !save.fired) { save.fired = true; const id = next++; dls[id] = c.blobDl!(); for (const f of created.slice()) f({ id, url: 'blob:https://www.tiktok.com/x' }) }
      return s
    }
    if (func.name === 'ttPageSaveStopInPage') return true
    return null
  }
  const env: Record<string, Any> = {
    chrome, trybeRun, openWorkTab: async () => ({ id: 5 }), waitForTabLoad: async () => {}, quietTabIds: new Set(), quietShim: async () => {},
    startKeepAlive: () => null, stopKeepAlive: () => {}, hasOrigins: async () => true, TT_ORIGINS: [], _sleep: sleep,
    ttRun: null, TT_HOOK_ID: 'hook', ttScrollInPage: function ttScrollInPage() { return 0 },
  }
  const code = c.max ? sec.replace('const TT_DL_MAX_MS = 6000', `const TT_DL_MAX_MS = ${c.max}`) : sec
  const make = new Function(...Object.keys(env), `${code}\nreturn { run: ttDownloadBounded, now: () => ttDlNow }`)
  return make(...Object.values(env)) as { run: (a: Any) => Promise<Any>; now: () => Any }
}
const ARGS = { handle: 'gominreviews', videoId: '7471234567890123456', filename: 'vigority-2026-02-15' }
const ways = (r: Any) => (r.tried || []).map((t: Any) => `${t.way}:${t.result}`).join(', ')

;(async () => {
  // Each case is its own SCOUT, so they run side by side.
  await Promise.all([
    async () => {
      const s = scout({ urls: URLS, chromeDl: () => item({ refuse: 'SERVER_FORBIDDEN' }), page: pageRead(2500), blobDl: () => item({ size: 4e6, rate: 4e6 }), windows: [] })
      const r = await s.run(ARGS)
      check(`the page's own read goes first, slow but moving, followed to the end and saved, and Chrome's own download is never tried (${ways(r)})`, r.ok && r.way === 'page' && r.bytes === 4e6 && ways(r) === 'page:ok')
    },
    async () => {
      const s = scout({ urls: URLS, chromeDl: () => item({ size: 6e6, rate: 1.5e6 }), windows: [], tab: { frozen: true, url: 'https://www.tiktok.com/@gominreviews/video/747' } })
      const t0 = Date.now()
      const r = await s.run(ARGS)
      check(`a page that stops answering is said with how Chrome held its tab, tried twice at most (${ways(r)})`, (r.tried || []).filter((t: Any) => t.way === 'page').length === 2 && /page:page-busy \(tab frozen by Chrome\)/.test(ways(r)))
      check(`then a slow download through Chrome that keeps moving is followed to the end (${ways(r)})`, r.ok && r.way === 'chrome' && r.bytes === 6e6 && Date.now() - t0 > 1500)
    },
    async () => {
      const s = scout({ urls: URLS, chromeDl: () => item({ size: 2e6, rate: 2e6, askLooks: 3 }), windows: [] })
      const r = await s.run(ARGS)
      check(`Chrome asking where to save is waited for and said, then saved (${ways(r)})`, r.ok && r.way === 'chrome' && s.now().asking === true)
    },
    async () => {
      // Seb's Downloads on 1.60.4: TikTok answered Chrome's own downloads with 300 KB pages.
      const removed: number[] = []
      const s = scout({ urls: URLS, chromeDl: () => item({ size: 319000, rate: 319000, mime: 'text/html' }), windows: [], removed })
      const r = await s.run(ARGS)
      const html = (r.tried || []).filter((t: Any) => t.result === 'chrome-not-a-video: text/html').length
      check(`a web page Chrome saved as .mp4 is deleted, never reported as the video (${ways(r)}; removed ${removed.length})`, !r.ok && r.error === 'not-saved' && html === 3 && removed.length === 3)
    },
    async () => {
      // A small file with a video's type is still not a whole TikTok video.
      const removed: number[] = []
      const s = scout({ urls: URLS, chromeDl: () => item({ size: 20000, rate: 20000 }), windows: [], removed })
      const r = await s.run(ARGS)
      check(`a file too small to be the video is deleted too (${ways(r)})`, !r.ok && /chrome:chrome-too-small/.test(ways(r)) && removed.length === 3)
    },
    async () => {
      // Seb on 1.60.5: a file that played 2 seconds and froze. TikTok sent 319 KB of a 4.5 MB video.
      const removed: number[] = []
      const s = scout({ urls: SIZED, chromeDl: () => item({ size: 319000, rate: 319000 }), windows: [], removed })
      const r = await s.run(ARGS)
      const cut = (r.tried || []).filter((t: Any) => /^chrome-cut-short: 319000 of (4533599|1596825) bytes$/.test(t.result)).length
      check(`a file smaller than TikTok says the video is was cut short: deleted and said, never saved (${ways(r)})`, !r.ok && r.error === 'not-saved' && cut === 3 && removed.length === 3 && /chrome-cut-short: 319000 of 4533599 bytes, deleted/.test(r.trace || ''))
    },
    async () => {
      const s = scout({ urls: SIZED, chromeDl: () => item({ size: 4533599, rate: 4533599 }), windows: [] })
      const r = await s.run(ARGS)
      check(`the whole file, as big as TikTok says, is kept, and the steps are written down (${r.trace})`, r.ok && r.way === 'chrome' && r.bytes === 4533599 && /hidden tab opened \| .*page loaded \| .*read 1: 3 addresses, first h264_720p 4533599 bytes/.test(r.trace || '') && /addresses \(video 38s long\)/.test(r.trace || '') && /saved by the chrome way$/.test(r.trace || ''))
    },
    async () => {
      // Seb's visible try on 1.60.5: "No tab with id". The tab closes while SCOUT reads it.
      const s = scout({ urls: () => ({ urls: [], found: false, seen: 'page /@x/video/1; data yes; video not found' }), chromeDl: () => item(), windows: [], closeAfter: 2 })
      const r = await s.run(ARGS)
      check(`a TikTok tab that closes part way is said as that, with when (${r.error}: ${r.seen})`, !r.ok && r.error === 'tab-closed' && /the TikTok tab closed \d+s after SCOUT began, while finding/.test(r.seen || '') && /tab closed during finding/.test(r.trace || ''))
    },
    async () => {
      const w: string[] = []
      const s = scout({ urls: URLS, chromeDl: () => item({ refuse: 'SERVER_FORBIDDEN' }), page: pageRead(500), blobDl: () => item({ size: 4e6, rate: 4e6, askLooks: 3 }), windows: w })
      const r = await s.run(ARGS)
      check(`when the page's save asks where to save, its window is shown, then put back down (${w.join(', ')})`, r.ok && r.way === 'page' && w[0] === 'normal' && w[w.length - 1] === 'minimized')
    },
    async () => {
      const s = scout({ urls: () => new Promise(() => {}), chromeDl: () => item(), windows: [] })
      const t0 = Date.now()
      const r = await s.run(ARGS)
      check(`TikTok's page never answering is stopped at the limit and says the step it reached (${r.error}, ${r.step})`, !r.ok && r.error === 'too-slow' && r.step === 'finding' && Date.now() - t0 < 9000)
    },
    async () => {
      const s = scout({ urls: URLS, chromeDl: () => item({ refuse: 'SERVER_FORBIDDEN' }), page: () => { const t0 = Date.now(); return { state: async () => ({ bytes: 1e6, total: 4e6, done: false, ok: false, error: null, still: Date.now() - t0 }) } }, windows: [] })
      const r = await s.run(ARGS)
      check(`TikTok stopping part way is not saved, and says how much had come in (${ways(r)})`, !r.ok && r.error === 'not-saved' && r.bytes === 1e6 && r.total === 4e6 && /^page:page-stalled/.test(ways(r)) && /chrome:chrome-SERVER_FORBIDDEN$/.test(ways(r)))
    },
    async () => {
      // The video's page shows nothing (Seb, 2026-11-09, on 1.60.2); the profile's grid has it after two scrolls.
      const noAddr = () => ({ urls: [], found: false, seen: 'page /@gominreviews/video/747; data yes (webapp.app-context); video not found; player blob' })
      const s = scout({ urls: noAddr, chromeDl: () => item({ size: 3e6, rate: 3e6 }), windows: [], max: 25000,
        grid: (n: number) => n >= 2 ? { found: true, urls: [{ url: 'https://v16-webapp-prime.tiktok.com/g', from: 'grid-bitrate' }], have: 90, hasMore: true, hooked: true } : { found: false, urls: [], have: 30 * (n + 1), hasMore: true, hooked: true } })
      const r = await s.run(ARGS)
      check(`a video page with no address is found in the profile’s own grid and saved (${ways(r)})`, r.ok && r.way === 'chrome' && r.from === 'grid-bitrate' && r.step === 'chrome')
    },
    async () => {
      const noAddr = () => ({ urls: [], found: false, seen: 'page /@gominreviews/video/747; data no; video not found; player none' })
      const s = scout({ urls: noAddr, chromeDl: () => item(), windows: [], max: 25000, grid: () => ({ found: false, urls: [], have: 120, hasMore: false, hooked: true }) })
      const r = await s.run(ARGS)
      check(`with no address on the page or the profile, it says what each showed (${r.seen})`, !r.ok && r.error === 'no-video-address' && /data no; video not found/.test(r.seen || '') && /profile: 120 videos read, this one not among them/.test(r.seen || ''))
    },
    async () => {
      const photo = () => ({ urls: [], found: true, photo: true, seen: 'page /@x/video/1; data yes; video found; photo post (6 pictures)' })
      const s = scout({ urls: photo, chromeDl: () => item(), windows: [] })
      const r = await s.run(ARGS)
      check(`a photo post is said, and nothing is tried (${r.error})`, !r.ok && r.error === 'photo-post' && r.tried.length === 0)
    },
    async () => {
      const blocked = () => ({ urls: [], found: false, status: 10204, seen: 'page /@x/video/1; data yes; status 10204; video not found' })
      const s = scout({ urls: blocked, chromeDl: () => item(), windows: [], max: 25000, grid: () => ({ found: false, urls: [], have: 40, hasMore: false, hooked: true }) })
      const r = await s.run(ARGS)
      check(`a status TikTok gave instead of the video is said with its code (${r.error} ${r.status})`, !r.ok && r.error === 'tiktok-status' && r.status === 10204 && /status 10204/.test(r.seen || ''))
    },
  ].map((f) => f()))

  // ── The page reading, on a page shaped like TikTok's ──
  {
    const fn = sec.slice(sec.indexOf('function ttVideoUrlsInPage'), sec.indexOf('// In page, on the creator\'s profile'))
    const page = (data: Any, extra: { ids?: string[]; text?: string } = {}) => {
      const doc = {
        getElementById: (id: string) => id === '__UNIVERSAL_DATA_FOR_REHYDRATION__' && data ? { textContent: JSON.stringify(data) } : (extra.ids || []).includes(id) ? {} : null,
        querySelector: () => null,
        body: { innerText: extra.text || '' },
      }
      return new Function('document', 'window', 'location', `${fn}\nreturn ttVideoUrlsInPage('7471')`)(doc, {}, { pathname: '/@x/video/7471' }) as Any
    }
    // TikTok gives each version's size as a string (DataSize), as on the real page.
    const ver = (key: string, br: number, hosts: string[]) => ({ Bitrate: br, PlayAddr: { UrlKey: key, DataSize: String(Math.round(br * 38 / 8)), UrlList: hosts.map((h) => `https://${h}/video/tos/${key}`) } })
    const data = { __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: { id: '7471', video: {
      bitrateInfo: [ver('v1_bytevc2_1080p_3000000', 3000000, ['v16.tiktok.com']), ver('v1_bytevc1_1080p_2500000', 2500000, ['v16.tiktok.com']), ver('v1_h264_720p_1900000', 1900000, ['www.tiktok.com', 'v16.tiktok.com', 'v19.tiktok.com']), ver('v1_h264_540p_1100000', 1100000, ['v16.tiktok.com'])],
      playAddr: 'https://v16.tiktok.com/video/tos/play', downloadAddr: 'https://v16.tiktok.com/video/tos/download', duration: 38, size: '9025000' } } } } } }
    const r = page(data)
    const order = r.urls.map((u: Any) => u.url.replace('https://', '').replace('/video/tos/', ' '))
    check(`H.264 comes first, best first, www.tiktok.com after, bytevc2 left out, the watermarked version near the end (${order.join(' | ')})`,
      order[0] === 'v16.tiktok.com v1_h264_720p_1900000' && order[1] === 'v19.tiktok.com v1_h264_720p_1900000' && order[2] === 'v16.tiktok.com v1_h264_540p_1100000'
      && !order.some((o: string) => /bytevc2/.test(o)) && order.indexOf('www.tiktok.com v1_h264_720p_1900000') > order.indexOf('v16.tiktok.com v1_bytevc1_1080p_2500000') && order.indexOf('v16.tiktok.com download') > order.indexOf('v16.tiktok.com play'))
    check(`each version carries the size TikTok gives for it, and the video its length (${r.urls[0].size}, ${r.dur})`, r.urls[0].size === 9025000 && r.urls[0].q === 'h264_720p' && r.urls.find((u: Any) => /download$/.test(u.url)).size === 0 && r.urls.find((u: Any) => /play$/.test(u.url)).size === 9025000 && r.dur === 38)
    check('what the page held is said, with the versions TikTok listed', /data yes \(webapp\.video-detail\); status 0; video found/.test(r.seen) && /versions bytevc2_1080p_3000000 bytevc1_1080p_2500000 h264_720p_1900000/.test(r.seen))
    const wait = page(null, { ids: ['cs', 'wci'], text: 'Please wait...' })
    check('TikTok’s "Please wait..." check page is told apart, so SCOUT waits for it', wait.challenge === true && wait.urls.length === 0 && /TikTok check page/.test(wait.seen))
    const pics = page({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: { id: '7471', imagePost: { images: [{}, {}, {}] }, video: { duration: 0 } } } } } })
    check('a photo post is told apart', pics.photo === true && pics.urls.length === 0 && /photo post \(3 pictures\)/.test(pics.seen))
    const st = page({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { statusCode: 10204, statusMsg: 'blocked' } } })
    check('a status instead of the video is read', st.status === 10204 && st.found === false && /status 10204 blocked/.test(st.seen))
  }

  // ── The page way's own check of the file, on an MP4 whole and cut short ──
  {
    const save = sec.slice(sec.indexOf('function ttPageSaveStartInPage'), sec.indexOf('function ttPageSaveStateInPage'))
    const box = (type: string, size: number) => { const b = new Uint8Array(size); new DataView(b.buffer).setUint32(0, size); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i); return b }
    const mp4 = new Uint8Array([...box('ftyp', 24), ...box('moov', 400), ...box('mdat', 300000)])
    const run = async (bytes: Uint8Array, want: number) => {
      const win: Any = {}
      const clicked: string[] = []
      const doc = { querySelectorAll: () => [], createElement: () => ({ click() { clicked.push('a') }, remove() {}, style: {} }), body: { appendChild() {} } }
      const fetchFn = async () => new Response(new Blob([bytes as BlobPart]), { headers: { 'content-type': 'video/mp4' } })
      const url = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }
      new Function('window', 'document', 'fetch', 'URL', `${save}\nreturn ttPageSaveStartInPage('https://v16/x', 'v.mp4', true, ${want})`)(win, doc, fetchFn, url)
      for (let i = 0; i < 50 && !win.__mvpTtSave.done; i++) await sleep(20)
      return { ...win.__mvpTtSave, clicked: clicked.length }
    }
    const whole = await run(mp4, mp4.length)
    check(`a whole MP4 is saved (${whole.error || 'ok'})`, whole.ok === true && whole.clicked === 1)
    const cut = await run(mp4.slice(0, 120000), mp4.length)
    check(`an MP4 cut short is not saved, and says how much came (${cut.error}: ${cut.detail})`, cut.ok === false && cut.error === 'page-cut-short' && /120000 bytes, boxes ftyp,moov,mdat/.test(cut.detail) && cut.clicked === 0)
    const small = await run(mp4, mp4.length * 3)
    check(`a whole MP4 smaller than TikTok says is not saved (${small.error}: ${small.detail})`, small.ok === false && small.error === 'page-cut-short' && / of \d+ bytes/.test(small.detail))
  }
  if (fails.length) { console.error(`✗ ${fails.length} SCOUT TikTok download check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
  console.log('✓ SCOUT TikTok download: the page’s own read first, a refused, slow, asking, silent or broken download each ends saved or says where it stopped and how much came in; a web page saved as .mp4 or a file cut short deleted, both ways; a closed tab said; a video its page hides is found on the profile; H.264 first; photo posts, TikTok statuses and its check page told apart')
  process.exit(0)
})()
