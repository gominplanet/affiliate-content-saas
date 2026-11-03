// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE FIRST, ALWAYS (Seb, 2026-11-03: "can we make sure that the Trybe
// feature works perfectly.. at times it does not load.. as if scout is not
// opening the trybe page in the background.. this should always be the first
// thing it does for it to work").
//
// Pinned, with a stand-in SCOUT answering MVP's real request code:
//   • a TRYBE request that finds TRYBE closed opens it behind MVP's tab, waits
//     for it, and is asked again, so the inbox and brands load;
//   • several requests finding it closed at once open it ONCE;
//   • a send found closed is sent once TRYBE is open, but one SCOUT had
//     started on is never sent twice;
//   • a TRYBE that will not open ends in words, not a loop;
//   • a SCOUT too old to open TRYBE is never asked to.
// And in SCOUT 1.54.0 itself: every request, upload, brand list read and Send
// all run opens TRYBE behind MVP's tab first, through one opener; and MVP's
// TRYBE page reopens TRYBE whenever it is found closed, not once a visit.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

// ── A stand-in SCOUT ─────────────────────────────────────────────────────────
type Msg = { type: string; [k: string]: unknown }
const scout = { version: '1.53.9', tab: false, canOpen: true, opens: 0, sends: 0, asked: [] as string[] }
const answer = async (m: Msg): Promise<unknown> => {
  scout.asked.push(m.type)
  switch (m.type) {
    case 'MVP_PING': return { ok: true, version: scout.version }
    case 'MVP_TRYBE_TAB': return { open: scout.tab, allowed: true, signedIn: true }
    case 'MVP_TRYBE_TAB_OPEN':
      scout.opens++
      await new Promise((r) => setTimeout(r, 30))
      if (!scout.canOpen) return { open: false, error: 'could-not-open' }
      scout.tab = true
      return { open: true, opened: true }
    case 'MVP_TRYBE_API': return scout.tab ? { ok: true, status: 200, json: { data: [m.path] } } : { ok: false, error: 'trybe-not-open' }
    case 'MVP_TRYBE_SEND':
      if (!scout.tab) return { outcome: 'failed', error: 'trybe-not-open', steps: [] }
      scout.sends++
      return { outcome: 'sent', steps: ['pressed Send Request'] }
    default: return null
  }
}
const g = globalThis as unknown as { window: unknown }
g.window = {
  addEventListener: () => {}, postMessage: () => {},
  chrome: { runtime: { lastError: undefined, sendMessage: (_id: string, m: Msg, cb: (r: unknown) => void) => { void answer(m).then(cb) } } },
}
const reset = (o: Partial<typeof scout> = {}) => Object.assign(scout, { version: '1.53.9', tab: false, canOpen: true, opens: 0, sends: 0, asked: [] }, o)

async function main() {
  const F = await import('../lib/extension-frame')

  // Three reads at once, TRYBE closed: opened once, all three answered.
  reset()
  const reads = await Promise.all(['/backend/api/channels', '/backend/api/inbox', '/backend/api/creator/v2/brands/stats'].map((p) => F.requestTrybeApi('GET', p)))
  check('reads that find TRYBE closed open it first, then load', reads.every((r) => r.ok), reads)
  check('several requests at once open TRYBE once, never a tab each', scout.opens === 1, scout.opens)

  // Already open: nothing is opened.
  reset({ tab: true })
  await F.requestTrybeApi('GET', '/backend/api/channels?x=1')
  check('TRYBE already open is used as it is', scout.opens === 0 && !scout.asked.includes('MVP_TRYBE_TAB_OPEN'))

  // A send found closed: TRYBE opened, sent once.
  reset()
  const sent = await F.requestTrybeSend('https://jointrybe.com/creator/discover?brand=1', 'Brand', 'Hi')
  check('a send that finds TRYBE closed is sent once TRYBE is open', sent.outcome === 'sent' && scout.sends === 1 && scout.opens === 1, sent)

  // A send SCOUT had started on is never sent again.
  reset()
  const started = { outcome: 'failed' as const, error: 'trybe-not-open', steps: ['opened the brand'] }
  const orig = answer
  let calls = 0
  ;(g.window as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = (_id: string, m: Msg, cb: (r: unknown) => void) => {
    if (m.type === 'MVP_TRYBE_SEND') { calls++; cb(started); return }
    void orig(m).then(cb)
  }
  await F.requestTrybeSend('https://jointrybe.com/x', 'Brand', 'Hi')
  check('a send SCOUT had already started on is never sent twice', calls === 1, calls)
  ;(g.window as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = (_id: string, m: Msg, cb: (r: unknown) => void) => { void answer(m).then(cb) }

  // TRYBE will not open: words, once, no loop.
  reset({ canOpen: false })
  const stuck = await F.requestTrybeApi('GET', '/backend/api/profile')
  check('a TRYBE that will not open ends in words, not a loop', !stuck.ok && /TRYBE is not open/.test(stuck.error || '') && scout.opens === 1, { stuck, opens: scout.opens })

  // Too old to open TRYBE: never asked.
  reset({ version: '1.53.2' })
  const old = await F.ensureTrybeTab()
  check('a SCOUT too old to open TRYBE is never asked to', old === 'closed' && !scout.asked.includes('MVP_TRYBE_TAB_OPEN'))

  // ensureTrybeTab says where it ended.
  reset()
  check('opening TRYBE ends open', (await F.ensureTrybeTab()) === 'open' && scout.opens === 1)

  // ── SCOUT 1.54.0 itself ────────────────────────────────────────────────────
  const B = readFileSync('extension/background.js', 'utf8')
  const M = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))
  const opener = B.slice(B.indexOf('function trybeOpenBehind('), B.indexOf('function trybeOpenBehind(') + 2000)
  check('SCOUT is 1.54.0', M.version === '1.54.0' && /SCOUT_LATEST_VERSION = '1\.54\.0'/.test(readFileSync('lib/scout-version.ts', 'utf8')))
  check('every SCOUT request opens TRYBE first when it is not open', /async function trybeApiTabId\(\) \{\s*const id = await trybeOwnTab\(\)\s*if \(id != null\) return id\s*const opened = await trybeOpenBehind\(trybeLastMvpTab, false\)/.test(B))
  check('one opener, so TRYBE is never opened twice', /if \(trybeOpening\) return trybeOpening/.test(opener) && /\.finally\(\(\) => \{ trybeOpening = null \}\)/.test(opener))
  check('it opens next to the MVP tab that asked, behind it, kept awake, loaded and watched', /index: near\.index \+ 1/.test(opener) && /active: !!focus/.test(opener) && /autoDiscardable: false/.test(opener) && /waitForTabLoad\(t\.id, 30000\)/.test(opener) && /files: \['trybe-hook\.js'\]/.test(opener))
  check('never a window of its own for TRYBE', !/windows\.create/.test(opener))
  check('SCOUT remembers which MVP tab asked', /if \(\/\^MVP_TRYBE_\/\.test\(msg\.type\) && sender && sender\.tab && sender\.tab\.id != null\) trybeLastMvpTab = sender\.tab\.id/.test(B))
  check('MVP’s own Open TRYBE uses the same opener', /const id = await trybeOpenBehind\(sender && sender\.tab \? sender\.tab\.id : null, !!msg\.focus\)/.test(B))
  check('the brand list read and Send all open TRYBE first instead of stopping', /try \{ tabId = await trybeApiTabId\(\) \} catch \(e\) \{ tabId = null \}/.test(B) && /try \{ runTab = await trybeApiTabId\(\) \} catch \(e\) \{ runTab = null \}/.test(B) && /Stopped: SCOUT could not open TRYBE in this Chrome/.test(B))

  // SCOUT's opener, run against a fake Chrome: three requests at once with no
  // TRYBE tab open one tab, next to MVP's, behind it; an open tab is used.
  {
    const start = B.indexOf('async function trybeApiTabId()')
    const end = B.indexOf('return trybeOpening\n}', start) + 'return trybeOpening\n}'.length
    const created: Array<Record<string, unknown>> = []
    let trybeTabs: number[] = []
    const fakeChrome = {
      tabs: {
        get: async (id: number) => ({ id, windowId: 7, index: 3 }),
        create: async (o: Record<string, unknown>) => { created.push(o); await new Promise((r) => setTimeout(r, 20)); trybeTabs.push(100 + created.length); return { id: 100 + created.length } },
        update: async () => ({}),
      },
      windows: { getLastFocused: async () => ({ id: 9 }) },
      scripting: { executeScript: async () => [] },
    }
    const make = new Function('chrome', 'trybeOwnTab', 'hasTrybeAccess', 'TRYBE_DISCOVER', 'waitForTabLoad', '_sleep',
      `${B.slice(start, end)}\n;return { trybeApiTabId, setMvp: (id) => { trybeLastMvpTab = id } }`)
    const api = make(fakeChrome, async () => (trybeTabs.length ? trybeTabs[0] : null), async () => true, 'https://jointrybe.com/creator/discover', async () => {}, async () => {}) as { trybeApiTabId: () => Promise<number>; setMvp: (id: number) => void }
    api.setMvp(42)
    const ids = await Promise.all([api.trybeApiTabId(), api.trybeApiTabId(), api.trybeApiTabId()])
    check('SCOUT, three requests at once and no TRYBE tab: one tab opened, all three use it', created.length === 1 && new Set(ids).size === 1, { created, ids })
    check('SCOUT opens it next to the MVP tab that asked, behind it', created[0]?.windowId === 7 && created[0]?.index === 4 && created[0]?.active === false && created[0]?.url === 'https://jointrybe.com/creator/discover', created[0])
    await api.trybeApiTabId()
    check('SCOUT uses a TRYBE tab that is open, opening nothing', created.length === 1)
    trybeTabs = []; created.length = 0
    const api2 = make(fakeChrome, async () => (trybeTabs.length ? trybeTabs[0] : null), async () => true, 'https://jointrybe.com/creator/discover', async () => {}, async () => {}) as { trybeApiTabId: () => Promise<number> }
    await api2.trybeApiTabId()
    check('with no MVP tab known (SCOUT restarted), it goes in the window used last', created[0]?.windowId === 9 && created[0]?.active === false, created[0])
  }

  // ── MVP's TRYBE page ───────────────────────────────────────────────────────
  const P = readFileSync('components/labs/TrybeOutreach.tsx', 'utf8')
  const X = readFileSync('lib/extension-frame.ts', 'utf8')
  check('the page reopens TRYBE whenever it is found closed, not once a visit', /const autoOpenedAt = useRef\(0\)/.test(P) && /void ensureTrybeTab\(\)\.then/.test(P) && /window\.setInterval\(go, 20_000\)/.test(P) && !/autoOpened\.current = true/.test(P))
  check('SCOUT asleep is asked again, not taken as no SCOUT', /for \(let i = 0; i < 3 && live && r\.state === 'no-answer'; i\+\+\)/.test(P))
  check('uploads, the brand list and Send all go TRYBE first too', /withTrybeOpen\(\(\) => sendToExtension<TrybePutResult>/.test(X) && /withTrybeOpen\(\(\) => sendToExtension<TrybeHarvestResult>/.test(X) && /\/\/ TRYBE first, so the run's first send has a tab to go through\.\n\s*await ensureTrybeTab\(\)/.test(X))
  check('MVP waits long enough for SCOUT to load TRYBE', /type: 'MVP_TRYBE_TAB_OPEN', focus \}, 45_000\)/.test(X))

  if (fails.length) { console.error(`\n❌ trybe-first: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
  console.log('✅ trybe-first: TRYBE opened behind MVP first, once, for every request, upload, brand list read and send; a send never twice; old SCOUT never asked')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
