// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE AMAZON VIDEO LIST SURVIVES ITS TAB GOING AWAY (SCOUT 1.60.9; Seb,
// 2026-11-11: "SCOUT read 400 videos from your Amazon video list (Amazon says
// 7,958): stopped: Frame with ID 0 was removed.").
//
// Runs the real scanCreatorHubVideosBackground out of background.js against a
// fake Chrome whose hidden Amazon tab reloads, or closes, between two batches.
// What is asserted: the read carries on from the batch that failed (no gap, no
// repeat), a closed tab is opened again, the page's fresh list request is taken
// after a reload, the tab is kept from Memory Saver, and a tab that keeps going
// away is said, with what was read kept.
import { readFileSync } from 'node:fs'

const src = readFileSync('extension/background.js', 'utf8')
function fnSource(name) {
  const start = src.indexOf(`async function ${name}(`)
  if (start < 0) throw new Error(`${name} not found`)
  let depth = 0, i = src.indexOf('{', src.indexOf(')', start)), end = -1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  return src.slice(start, end)
}
const scanSrc = fnSource('scanCreatorHubVideosBackground')

const fails = []
const check = (name, ok, detail) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

const LIB = 1000
const MANAGE = 'https://www.amazon.com/manage-content?ref=ive_cp'

function world({ breakOn = [], kind = 'reload' }) {
  let nextId = 7
  const tabs = new Map()
  const ring = []
  const asked = []
  const updates = []
  const created = []
  let calls = 0
  const capture = (tag) => ring.push({ url: 'https://www.amazon.com/manage-content/api/get-content-list', method: 'POST', headers: { tag }, body: JSON.stringify({ pageSize: 10, startIndex: 0 }) })
  const chrome = {
    runtime: { getManifest: () => ({ version: 'test' }) },
    tabs: {
      create: async ({ url }) => { const id = nextId++; tabs.set(id, { id, url, discarded: false }); created.push(id); capture(`load-${id}`); return { id } },
      get: async (id) => { const t = tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); return { ...t } },
      update: async (id, props) => { updates.push({ id, ...props }); const t = tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); if (props.url) { t.url = props.url; t.discarded = false; capture(`reload-${id}`) } return { ...t } },
      remove: async (id) => { tabs.delete(id) },
    },
    scripting: {
      executeScript: async ({ target, args }) => {
        calls++
        const rec = args[0]
        if (breakOn.includes(calls)) {
          if (kind === 'closed') { tabs.delete(target.tabId); throw new Error(`No tab with id: ${target.tabId}.`) }
          if (kind === 'discarded') { tabs.get(target.tabId).discarded = true; throw new Error('Frame with ID 0 was removed.') }
          capture(`reload-${target.tabId}`)
          throw new Error('Frame with ID 0 was removed.')
        }
        asked.push({ tabId: target.tabId, startAt: rec.startAt, tag: rec.headers && rec.headers.tag })
        const n = Math.max(0, Math.min(rec.maxRows, LIB - rec.startAt))
        const videos = Array.from({ length: n }, (_, k) => ({ aci: `aci-${rec.startAt + k}` }))
        return [{ result: { videos, total: LIB, nextOffset: rec.startAt + n, done: rec.startAt + n >= LIB, variant: 'metrics, 50 a page', pages: Math.ceil(n / 50) } }]
      },
    },
  }
  const saved = []
  const push = async (videos) => { saved.push(...videos.map((v) => v.aci)); return { ok: true } }
  const make = new Function('chrome', 'waitForTabLoad', '_sleep', '_ccNetRing', 'pushVideoLibraryToMvp', 'harvestCreatorHubVideosInPage', 'fetchContentListInPage', 'describeProbe',
    `${scanSrc}\nreturn scanCreatorHubVideosBackground`)
  const scan = make(chrome, async () => {}, async () => {}, ring, push, () => {}, () => {}, () => '')
  return { scan, tabs, asked, updates, created, saved }
}

// A. The page reloads under the second batch (Seb's "Frame with ID 0 was removed").
{
  const w = world({ breakOn: [2] })
  const r = await w.scan(MANAGE, 0, () => {})
  check('a reload under a batch: the whole library is read, from the batch that failed, nothing twice', r.ok && r.count === LIB && w.saved.length === LIB && new Set(w.saved).size === LIB && w.asked.map((a) => a.startAt).join() === '0,400,800', { r, asked: w.asked })
  check('after the reload the page’s fresh list request is used', w.asked[1] && w.asked[1].tag === `reload-${w.asked[0].tabId}`, w.asked)
  check('the hidden tab is kept from Memory Saver', w.updates.some((u) => u.autoDiscardable === false))
  check('it says it reached the end', /end of the library/.test(String(r.stopped)), r.stopped)
}
// B. The tab is closed under a batch: it is opened again and the read carries on.
{
  const w = world({ breakOn: [2], kind: 'closed' })
  const r = await w.scan(MANAGE, 0, () => {})
  check('a closed tab is opened again on Manage content and the read carries on', r.ok && r.count === LIB && w.created.length === 2 && w.asked.slice(1).every((a) => a.tabId === w.created[1]), { r, created: w.created, asked: w.asked })
}
// C. Chrome threw the tab away: it is loaded again.
{
  const w = world({ breakOn: [3], kind: 'discarded' })
  const r = await w.scan(MANAGE, 0, () => {})
  check('a discarded tab is loaded again and the read carries on', r.ok && r.count === LIB && w.updates.some((u) => u.url === MANAGE), { r, updates: w.updates })
}
// D. The tab keeps going away: said, and what was read is kept.
{
  const w = world({ breakOn: [2, 3, 4, 5, 6] })
  const r = await w.scan(MANAGE, 0, () => {})
  check('a tab that keeps going away stops the read with the reason, and the 400 read are kept', r.ok && r.count === 400 && r.partial === true && /Frame with ID 0 was removed/.test(String(r.stopped)) && r.nextOffset === 400, r)
}

if (fails.length) { console.error(`❌ amazon-list-tab-back: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ amazon-list-tab-back: the Amazon video list reads to the end when its tab reloads, closes or is thrown away, and says so when it keeps going')
