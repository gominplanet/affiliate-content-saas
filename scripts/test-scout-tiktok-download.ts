// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT'S TIKTOK DOWNLOAD, RUN (extension/background.js, 1.60.2; Seb,
// 2026-11-09: the download on 1.60.0 and again on 1.60.1 ended in "took too
// long", with nothing said about where it stuck). The download code itself is
// run here against a pretend Chrome and a pretend TikTok page, with its time
// limits shortened, in the ways it went wrong or could:
//
//   TikTok refuses Chrome's own download (no TikTok page behind it), and the
//     page's own read is slow but moving: saved, from the page
//   Chrome's download is slow but moving the whole time: followed to the end,
//     never cut off at a fixed time
//   Chrome asks where to save: waited for, said, and saved once answered
//   TikTok's page never answers SCOUT: stopped at the limit, and the answer
//     says which step it reached (1.60.1 said only "took too long")
//   TikTok stops sending part way: not saved, with how much had come in
//   the video's page gives no address (Seb's try on 1.60.2): found in the
//     profile's own video grid, scrolled until it comes, and saved
//   neither gives one: said, with what the page and the profile showed
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }

const B = readFileSync('extension/background.js', 'utf8')
const from = B.indexOf('// ── MATCH MY TIKTOK: DOWNLOAD A VIDEO (1.60.0 to 1.60.3)')
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
function item(o: { size?: number; rate?: number; refuse?: string; askLooks?: number; stopAfter?: number } = {}) {
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
      return { state: whole ? 'complete' : 'in_progress', bytesReceived: got, totalBytes: size, fileSize: whole ? size : 0, filename: asking ? '' : '/Downloads/vigority.mp4' }
    },
  }
}
const URLS = () => ({ urls: [{ url: 'https://v16-webapp-prime.tiktok.com/a', from: 'bitrate' }, { url: 'https://v19-webapp-prime.tiktok.com/b', from: 'bitrate' }, { url: 'https://www.tiktok.com/aweme/v1/play/c', from: 'bitrate' }], found: true })
// The page's own read, whole after `ms`.
const pageRead = (ms: number, size = 4e6) => () => { const t0 = Date.now(); return { state: async () => { const p = Math.min(1, (Date.now() - t0) / ms); return { bytes: Math.round(size * p), total: size, done: p >= 1, ok: p >= 1, error: null, still: 0 } } } }

interface Case { urls: () => Any; chromeDl: () => Any; page?: (args: Any[]) => Any; blobDl?: () => Any; windows: string[]; grid?: (scrolls: number) => Any
  /** A longer whole limit, for a case that also reads the profile. */
  max?: number }
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
      removeFile: (_id: number, cb?: () => void) => { if (cb) cb() },
      onCreated: { addListener: (f: Any) => created.push(f), removeListener: (f: Any) => { const i = created.indexOf(f); if (i >= 0) created.splice(i, 1) } },
    },
    tabs: { get: async () => ({ windowId: 9 }), remove: async () => {}, update: async () => ({}) },
    scripting: { registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    windows: { update: async (_id: number, o: { state: string }) => { c.windows.push(o.state) } },
  }
  let save: Any = null
  let scrolls = 0
  const trybeRun = async (func: Any, args: Any[]) => {
    if (func.name === 'ttVideoUrlsInPage') return c.urls()
    if (func.name === 'ttItemUrlsInPage') return c.grid ? c.grid(scrolls) : { found: false, urls: [], have: 0, hasMore: false, hooked: true }
    if (func.name === 'ttScrollInPage') { scrolls++; return 1 }
    if (func.name === 'ttPageSaveStartInPage') { save = c.page!(args); return true }
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
      check(`TikTok refuses Chrome's own download; the page's slow read is followed to the end and saved (${ways(r)})`, r.ok && r.way === 'page' && r.bytes === 4e6 && /chrome:chrome-SERVER_FORBIDDEN/.test(ways(r)) && /page:ok$/.test(ways(r)))
    },
    async () => {
      const s = scout({ urls: URLS, chromeDl: () => item({ size: 6e6, rate: 1.5e6 }), windows: [] })
      const t0 = Date.now()
      const r = await s.run(ARGS)
      check(`a slow download through Chrome that keeps moving is followed to the end (${ways(r)})`, r.ok && r.way === 'chrome' && r.bytes === 6e6 && Date.now() - t0 > 1500)
    },
    async () => {
      const s = scout({ urls: URLS, chromeDl: () => item({ size: 2e6, rate: 2e6, askLooks: 3 }), windows: [] })
      const r = await s.run(ARGS)
      check(`Chrome asking where to save is waited for and said, then saved (${ways(r)})`, r.ok && s.now().asking === true)
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
      check(`TikTok stopping part way is not saved, and says how much had come in (${ways(r)})`, !r.ok && r.error === 'not-saved' && r.bytes === 1e6 && r.total === 4e6 && /page:page-stalled/.test(ways(r)))
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
  ].map((f) => f()))
  if (fails.length) { console.error(`✗ ${fails.length} SCOUT TikTok download check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
  console.log('✓ SCOUT TikTok download: a refused, slow, asking, silent or broken download each ends saved or says where it stopped and how much came in, and a video its page hides is found on the profile')
  process.exit(0)
})()
