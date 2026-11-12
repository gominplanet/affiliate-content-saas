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

function world({ breakOn = [], kind = 'reload', flushed = false, unseen = false, pageIds = null, stored = null }) {
  let nextId = 7
  const tabs = new Map()
  const ring = []
  const asked = []
  const updates = []
  const created = []
  let calls = 0
  const store = stored ? { mvpVideoListRecipe: stored } : {}
  const stores = []
  // unseen: the page asked before SCOUT's hook was in, so nothing is captured
  // (Seb's runs on 1.60.9 and 1.60.10).
  const capture = (tag) => unseen ? 0 : ring.push({ url: 'https://www.amazon.com/manage-content/api/get-content-list', method: 'POST', headers: { tag }, body: JSON.stringify({ pageSize: 10, startIndex: 0 }) })
  const chrome = {
    runtime: { getManifest: () => ({ version: 'test' }) },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); stores.push(o) } } },
    tabs: {
      create: async ({ url }) => { const id = nextId++; tabs.set(id, { id, url, discarded: false }); created.push(id); capture(`load-${id}`); return { id } },
      get: async (id) => { const t = tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); return { ...t } },
      update: async (id, props) => { updates.push({ id, ...props }); const t = tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); if (props.url) { t.url = props.url; t.discarded = false; capture(`reload-${id}`) } return { ...t } },
      remove: async (id) => { tabs.delete(id) },
    },
    scripting: {
      executeScript: async ({ target, args, func }) => {
        if (func && func.name === 'listContextInPage') return [{ result: pageIds || { owner: null, csrf: null, via: [] } }]
        calls++
        const rec = args[0]
        if (breakOn.includes(calls)) {
          if (kind === 'closed') { tabs.delete(target.tabId); throw new Error(`No tab with id: ${target.tabId}.`) }
          if (kind === 'discarded') { tabs.get(target.tabId).discarded = true; throw new Error('Frame with ID 0 was removed.') }
          capture(`reload-${target.tabId}`)
          throw new Error('Frame with ID 0 was removed.')
        }
        let owner = null
        try { owner = JSON.parse(rec.body).ownerAffiliateId || null } catch (e) {}
        asked.push({ tabId: target.tabId, startAt: rec.startAt, tag: rec.headers && rec.headers.tag, owner, csrf: rec.headers && rec.headers['anti-csrftoken-a2z'], url: rec.url })
        const n = Math.max(0, Math.min(rec.maxRows, LIB - rec.startAt))
        const videos = Array.from({ length: n }, (_, k) => ({ aci: `aci-${rec.startAt + k}` }))
        return [{ result: { videos, total: LIB, nextOffset: rec.startAt + n, done: rec.startAt + n >= LIB, variant: 'metrics, 50 a page', pages: Math.ceil(n / 50) } }]
      },
    },
  }
  const saved = []
  const push = async (videos) => { saved.push(...videos.map((v) => v.aci)); return { ok: true } }
  const make = new Function('chrome', 'waitForTabLoad', '_sleep', '_ccNetRing', 'pushVideoLibraryToMvp', 'harvestCreatorHubVideosInPage', 'fetchContentListInPage', 'describeProbe', '_listNetRec', 'listContextInPage', 'VIDEO_LIST_RECIPE_KEY',
    `${scanSrc}\nreturn scanCreatorHubVideosBackground`)
  // Seb's run (1.60.10): the page's list request pushed out of the twelve-slot
  // ring by everything else it asked for, but kept in its own slot.
  let kept = null
  if (flushed) {
    kept = { url: 'https://www.amazon.com/manage-content/api/get-content-list', method: 'POST', headers: { tag: 'kept' }, body: JSON.stringify({ pageSize: 10, startIndex: 0 }), seenAt: Date.now() + 1000 }
    const realCreate = chrome.tabs.create
    chrome.tabs.create = async (o) => { const r = await realCreate(o); ring.length = 0; for (let i = 0; i < 12; i++) ring.push({ url: `https://www.amazon.com/other/${i}`, method: 'GET' }); return r }
  }
  // A token from the page's own other Amazon requests, as the page sends it.
  if (unseen) ring.push({ url: 'https://www.amazon.com/manage-content/api/other', method: 'POST', headers: { 'anti-csrftoken-a2z': 'ring-token' } })
  const scan = make(chrome, async () => {}, async () => {}, ring, push, () => {}, () => {}, () => '', kept, function listContextInPage() {}, 'mvpVideoListRecipe')
  return { scan, tabs, asked, updates, created, saved, stores }
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

// E. The list request was pushed out of the ring, and kept in its own slot.
{
  const w = world({ flushed: true })
  const r = await w.scan(MANAGE, 0, () => {})
  check('a list request pushed out of the ring is still used, from its own slot, and the whole library is read', r.ok && r.count === LIB && w.asked[0] && w.asked[0].tag === 'kept' && /own video list/.test(String(r.source)), { r, asked: w.asked })
}

// F. The page asked before SCOUT's hook was in (Seb's 91 and 52 videos):
// SCOUT asks for the list itself, with the ids on the page.
{
  const w = world({ unseen: true, pageIds: { owner: 'influencer-abc767279e2', csrf: 'page-token', via: ['page', 'csrf'] } })
  const r = await w.scan(MANAGE, 0, () => {})
  check('when the page was not seen asking, SCOUT asks for the whole list itself with the creator id from the page and the page\u2019s own token', r.ok && r.count === LIB && w.asked[0] && w.asked[0].owner === 'influencer-abc767279e2' && w.asked[0].csrf === 'ring-token' && /\/manage-content\/api\/get-content-list$/.test(w.asked[0].url) && /asked for by SCOUT \(the ids on the page\)/.test(String(r.source)), { r, asked: w.asked[0] })
  check('a list SCOUT asked for itself is not kept as the request to reuse', w.stores.length === 0)
}
// G. No ids on the page: the last request that worked, kept in this Chrome.
{
  const stored = { url: 'https://www.amazon.com/manage-content/api/get-content-list', method: 'POST', headers: { 'anti-csrftoken-a2z': 'old-token', 'x-keep': '1' }, body: JSON.stringify({ pageSize: 10, startIndex: 0, ownerAffiliateId: 'influencer-stored01' }) }
  const w = world({ unseen: true, stored })
  const r = await w.scan(MANAGE, 0, () => {})
  check('with no ids on the page, the last request that worked is asked again, with today\u2019s token', r.ok && r.count === LIB && w.asked[0].owner === 'influencer-stored01' && w.asked[0].csrf === 'ring-token' && /the last request that worked/.test(String(r.source)), { r, asked: w.asked[0] })
}
// H. A list request seen on the page that reads the library is kept for next time.
{
  const w = world({})
  const r = await w.scan(MANAGE, 0, () => {})
  const k = w.stores.find((o) => o.mvpVideoListRecipe)
  check('a list request seen on the page that read the library is kept, in this Chrome, for a run that does not see it', r.ok && !!k && /get-content-list/.test(k.mvpVideoListRecipe.url) && !!k.mvpVideoListRecipe.body)
}
// I. Nothing seen, no ids, nothing kept: said, never a silent grid read.
{
  const w = world({ unseen: true })
  const r = await w.scan(MANAGE, 0, () => {})
  check('with nothing to ask with, SCOUT asks Amazon for nothing and says it could not find the creator id', w.asked.every((a) => !a.url) && /could not find your creator id/.test(JSON.stringify(r)), r)
}

if (fails.length) { console.error(`❌ amazon-list-tab-back: ${fails.length} failure(s)\n${fails.map((f) => `   • ${f}`).join('\n')}`); process.exit(1) }
console.log('✅ amazon-list-tab-back: the Amazon video list reads to the end when its tab reloads, closes or is thrown away, and says so when it keeps going')
