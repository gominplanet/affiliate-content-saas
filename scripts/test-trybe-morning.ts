// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE MORNING RUN (Seb, 2026-11-06: "even if it's once a day ... Scout could
// do it automatically, gather all the information we need from Tribe, from
// Meta, from all the brands"). Pinned: SCOUT's own morning code, run against
// a pretend Chrome on a fixed clock (once a day, today's hour or tomorrow's,
// a catch-up when Chrome starts late, the morning before's tab used again,
// never in front); the page starts itself only when SCOUT opened it, never
// asks or grabs the screen on a morning run, and still reads products and
// Meta when TRYBE is not ready; the switch says what SCOUT answered.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { morningWords } from '../lib/trybe-morning'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// ── SCOUT'S MORNING CODE, IN A PRETEND CHROME ────────────────────────────────
const BG = read('extension/background.js')
const start = BG.indexOf('// ── TRYBE EVERY MORNING (1.56.0)')
const end = BG.indexOf('\n\n', BG.indexOf("chrome.tabs.onUpdated.addListener((tabId, info, tab) => {", start))
const block = BG.slice(start, end)
check('SCOUT has the morning run', start > 0 && end > start)

async function world(nowLocal: [number, number, number, number, number], stored: Record<string, unknown> = {}, openTabs: Array<{ id: number; url: string }> = []) {
  const NOW = new Date(...nowLocal).getTime()
  class FakeDate extends Date {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...a: any[]) { if (a.length) super(...(a as [number])); else super(NOW) }
    static now() { return NOW }
  }
  const store: Record<string, unknown> = { mvpTrybeMorning: stored }
  const alarms: Array<{ name: string; when: number }> = []
  const created: Array<{ url: string; active: boolean }> = []
  const updated: Array<{ id: number; url: string; active: boolean }> = []
  const listeners: { alarm?: (a: { name: string }) => void; startup?: () => void } = {}
  const chrome = {
    storage: { local: { get: async (k: string) => ({ [k]: store[k] }), set: async (o: Record<string, unknown>) => { Object.assign(store, o) } } },
    alarms: {
      clear: async (n: string) => { for (let i = alarms.length - 1; i >= 0; i--) if (alarms[i].name === n) alarms.splice(i, 1) },
      create: (n: string, o: { when: number }) => { alarms.push({ name: n, when: o.when }) },
      onAlarm: { addListener: (f: (a: { name: string }) => void) => { listeners.alarm = f } },
    },
    tabs: {
      get: async (id: number) => { const t = openTabs.find((x) => x.id === id); if (!t) throw new Error('no tab'); return t },
      query: async () => openTabs,
      update: async (id: number, o: { url: string; active: boolean }) => { updated.push({ id, ...o }); return { id } },
      create: async (o: { url: string; active: boolean }) => { created.push(o); return { id: 77 } },
      onUpdated: { addListener: () => {} },
    },
    runtime: { onStartup: { addListener: (f: () => void) => { listeners.startup = f } }, onInstalled: { addListener: () => {} } },
  }
  const ctx = vm.createContext({ chrome, Date: FakeDate, console })
  vm.runInContext(`${block}\n;globalThis.__m = { trybeMorningArm, trybeMorningRun, trybeMorningSave, trybeMorningState }`, ctx)
  const m = (ctx as unknown as { __m: { trybeMorningArm: () => Promise<number | null>; trybeMorningRun: () => Promise<void> } }).__m
  return { m, store, alarms, created, updated, listeners, NOW }
}
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime()
const ON = { on: true, origin: 'https://mvpaffiliate.io', hour: 4, minute: 0 }

;(async () => {
  {
    // 2 AM: the run is later today.
    const w = await world([2026, 10, 7, 2, 0], { ...ON })
    const next = await w.m.trybeMorningArm()
    check('before the hour, the next run is today at the hour', next === at(2026, 10, 7, 4) && w.alarms.length === 1)
    await w.m.trybeMorningRun()
    check('a run before the hour opens nothing', w.created.length === 0 && w.updated.length === 0)
  }
  {
    // 4:00 alarm: opens MVP's TRYBE page behind, once, then tomorrow.
    const w = await world([2026, 10, 7, 4, 0], { ...ON })
    await w.m.trybeMorningRun()
    check('at the hour, MVP\'s TRYBE page opens behind the creator\'s tabs with daily=auto', w.created.length === 1 && w.created[0].url === 'https://mvpaffiliate.io/trybe?daily=auto' && w.created[0].active === false)
    check('then the next run is tomorrow', w.alarms.length === 1 && w.alarms[0].when === at(2026, 10, 8, 4))
    await w.m.trybeMorningRun()
    check('once a day: a second wake the same day opens nothing more', w.created.length === 1)
  }
  {
    // Chrome started at 9:15 and the morning has not run: a catch-up, once.
    const w = await world([2026, 10, 7, 9, 15], { ...ON, lastDay: '2026-11-6' })
    w.listeners.startup?.()
    await new Promise((r) => setTimeout(r, 20))
    check('Chrome started after the hour: today\'s run happens then', w.created.length === 1)
  }
  {
    // The morning before's tab is used again, never a pile of tabs.
    const w = await world([2026, 10, 8, 4, 0], { ...ON, lastDay: '2026-11-7', tabId: 31 }, [{ id: 31, url: 'https://mvpaffiliate.io/trybe?tab=find' }])
    await w.m.trybeMorningRun()
    check('the tab from the morning before is used again, behind', w.created.length === 0 && w.updated.length === 1 && w.updated[0].id === 31 && w.updated[0].active === false && /daily=auto/.test(w.updated[0].url))
  }
  {
    const w = await world([2026, 10, 7, 4, 0], { ...ON, on: false })
    await w.m.trybeMorningRun()
    check('off: nothing opens and no alarm is set', w.created.length === 0 && w.alarms.length === 0 && (await w.m.trybeMorningArm()) === null)
  }

  // ── WHAT SCOUT ANSWERS MVP ─────────────────────────────────────────────────
  check('the switch is answered for MVP\'s own site only, with the hour kept to a real time', /if \(msg\.type === 'MVP_TRYBE_MORNING'\) \{/.test(BG) && /\/\^MVP_\(TRYBE\|HASHTAG\)_\/\.test\(msg\.type\) && !trybeCallerOk\(sender\)/.test(BG) && /h >= 0 && h <= 23 \? h : 4/.test(BG))
  const M = JSON.parse(read('extension/manifest.json'))
  check('SCOUT 1.56.0, with no new permission', M.version === '1.56.0' && /SCOUT_LATEST_VERSION = '1\.56\.0'/.test(read('lib/scout-version.ts')) && /SCOUT_TRYBE_MORNING_MIN_VERSION = '1\.56\.0'/.test(read('lib/scout-version.ts'))
    && JSON.stringify(M.permissions.slice().sort()) === JSON.stringify(['activeTab', 'alarms', 'downloads', 'scripting', 'storage', 'tabs']))

  // ── THE PAGE ───────────────────────────────────────────────────────────────
  const O = read('components/labs/TrybeOutreach.tsx')
  check('the page starts itself only when SCOUT opened it, once, for the team, and cleans its address', /\/\[\?&\]daily=auto\(&\|\$\)\/\.test\(window\.location\.search\)/.test(O)
    && /if \(!autoAsked \|\| autoDaily\.current \|\| !isAdmin \|\| preview \|\| !directory \|\| daily\?\.running\) return/.test(O) && /u\.searchParams\.delete\('daily'\)/.test(O) && /void dailyRefresh\(true\)/.test(O))
  check('a morning run never asks for Allow, never brings TRYBE to the front, never waits for a sign-in', /if \(auto\) return false/.test(O) && /if \(t === 'signed-out' && auto\) \{ setTrybeTab\(t\); return \{ ok: false/.test(O) && /trybeReady\(\(t\) => step\('trybe', 'running', t\), auto\)/.test(O))
  check('TRYBE not ready stops only the two TRYBE steps; products and Meta ads still run', /if \(!ready\.ok\) step\('trybe', 'failed', ready\.text\)/.test(O) && /step\('top100', 'skipped', 'Not read: TRYBE was not ready\.'\)/.test(O) && /step\('list', 'skipped', 'Not collected: TRYBE was not ready\.'\)/.test(O)
    && !/stopRest\(\['top100', 'list', 'products', 'meta'\], 'Not started: TRYBE was not ready\.'\)/.test(O))
  check('a run that started by itself is kept as one and said', /log: \{ at, auto, steps/.test(O) && /auto: log\.auto === true/.test(read('app/api/labs/trybe/route.ts')) && /, by itself/.test(O))
  check('the switch sits on the Daily refresh card, for the team, with an hour to pick', /Run it by itself every morning at/.test(O) && /aria-label="Hour of the morning run"/.test(O) && /requestTrybeMorning\(\{ on, hour, minute \}\)/.test(O) && /needs SCOUT \{SCOUT_TRYBE_MORNING_MIN_VERSION\}/.test(O))

  // ── WHAT THE SWITCH SAYS ───────────────────────────────────────────────────
  const T = Date.UTC(2026, 10, 7, 9)
  check('no answer from SCOUT is said, never shown as off', /SCOUT did not answer/.test(morningWords(null)))
  check('on: the next run and what it needs', /^On\. Next run /.test(morningWords({ on: true, hour: 4, minute: 0, next: T, lastAt: null, lastResult: null })) && /a computer asleep at that hour runs it when it wakes/.test(morningWords({ on: true, hour: 4, minute: 0, next: T, lastAt: null, lastResult: null })))
  check('a morning that found MVP signed out says nothing ran', /signed out of MVP, so nothing ran/.test(morningWords({ on: true, hour: 4, minute: 0, next: T, lastAt: T, lastResult: 'signed-out' })))
  check('off says how to run it', /^Off\. Press Daily refresh yourself/.test(morningWords({ on: false, hour: 4, minute: 0, next: null, lastAt: null, lastResult: null })))
  check('no dashes in the words', [morningWords(null), morningWords({ on: true, hour: 4, minute: 0, next: T, lastAt: T, lastResult: 'could-not-open' })].every((w) => !/[–—]| - /.test(w)))

  if (fails.length) {
    console.error(`❌ trybe-morning: ${fails.length} failure(s)\n`)
    for (const f of fails) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ trybe-morning: SCOUT runs the Daily refresh by itself once a day at the hour set, behind the tabs, and the page says how it went')
})()
