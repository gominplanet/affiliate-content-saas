// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEND ALL, RUN BY SCOUT ITSELF (SCOUT 1.48.0). A creator, 2026-10-16: "is
// there a way to keep the window popping in the background? when you are
// sending messages and doing something else it cuts you off".
//
// The runner in extension/background.js is run here for real, with Chrome,
// MVP's API and TRYBE's page faked: it claims each brand, sends it out of
// sight, records the result, waits on MVP's pacing, stops on the cap, on two
// failures in a row and on Stop, never takes the screen, and settles a send
// cut off by a restart as not confirmed. The page side is held by source.
import { readFileSync } from 'node:fs'
import * as OUT from '../lib/trybe-outreach'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: string) => { if (!ok) fails.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')
const BG = read('extension/background.js')
const UI = read('components/labs/TrybeOutreach.tsx')

const start = BG.indexOf('// ── TRYBE SENDS, RUN BY SCOUT ITSELF')
const end = BG.indexOf("try { chrome.runtime.onStartup.addListener(() => { void trybeRunTick() }) } catch (e) {}")
check('the runner is in SCOUT', start > 0 && end > start)
const RUNNER = BG.slice(start, end)
const SENDER = BG.slice(BG.indexOf('async function trybeSend('), BG.indexOf('\n}\n', BG.indexOf('async function trybeSend(')))

// ── Pacing: SCOUT waits exactly as MVP's page did ──
check('SCOUT paces sends with MVP\'s numbers', new RegExp(`shortUnder: ${OUT.SHORT_RUN_UNDER}, shortMs: ${OUT.SHORT_GAP_MS}, minMs: ${OUT.MIN_GAP_MS}, maxMs: ${OUT.MAX_GAP_MS}, breakEvery: ${OUT.BREAK_EVERY}, breakMs: \\[${OUT.BREAK_MS[0]}, ${OUT.BREAK_MS[1]}\\]`).test(RUNNER))

// ── Nothing opens: a run sends through the creator's own TRYBE tab ──
// 1.53.2 (Seb, 2026-10-19: "As long as nothing pops up, we're good"): a send is
// TRYBE's own request from the TRYBE tab the creator left open. No window, no
// tab, nothing brought forward.
check('a send opens nothing and brings nothing forward', !/openWorkTab|tabs\.create|windows\.(create|update)|showWorkTab|forward\(\)/.test(SENDER) && /trybeApi\(\{ method: 'POST', path: TRYBE_JOIN_PATH/.test(SENDER))
check('the runner sends with no MVP tab to bring back', /trybeSend\(\{ url: d\.url, name: d\.name, message: d\.message \}\)/.test(RUNNER))

type Store = Record<string, unknown>
async function sim(opts: {
  ids: string[]
  claim?: (id: string, n: number) => Record<string, unknown> | 'unreached'
  send?: (id: string) => { outcome: string; error?: string; steps?: string[] }
  stopAfter?: number
  /** No TRYBE tab open in this Chrome. */
  noTab?: boolean
}) {
  const store: Store = {}
  const results: Array<{ brandId: string; outcome: string; error: string | null }> = []
  const claims: string[] = []
  const sends: Array<{ url: string; behind: boolean; at: number }> = []
  const alarms: Array<{ name: string; when: number }> = []
  let clock = 1_000_000
  let claimN = 0
  const chrome = {
    storage: { local: {
      get: async (k: string) => ({ [k]: store[k] ? JSON.parse(JSON.stringify(store[k])) : undefined }),
      set: async (o: Store) => { for (const [k, v] of Object.entries(o)) store[k] = JSON.parse(JSON.stringify(v)) },
    } },
    alarms: { create: (name: string, o: { when: number }) => { alarms.push({ name, when: o.when }) }, clear: () => {}, onAlarm: { addListener: () => {} } },
    runtime: { onStartup: { addListener: () => {} } },
  }
  const fetchFake = async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    if (body.action === 'claim') {
      claims.push(body.brandId)
      const c = opts.claim ? opts.claim(body.brandId, claimN++) : { ok: true, name: `Brand ${body.brandId}`, url: `https://jointrybe.com/x/${body.brandId}`, message: 'Hi', usedToday: 1 }
      if (c === 'unreached') throw new Error('offline')
      return { ok: true, status: 200, json: async () => c }
    }
    if (body.action === 'result') { results.push({ brandId: body.brandId, outcome: body.outcome, error: body.error ?? null }); return { ok: true, status: 200, json: async () => ({ ok: true }) } }
    return { ok: false, status: 400, json: async () => ({}) }
  }
  const trybeSend = async (a: { url: string }) => {
    sends.push({ url: a.url, behind: true, at: clock })
    if (opts.stopAfter != null && sends.length === opts.stopAfter) {
      const st = store.mvpTrybeRun as { on: boolean }
      store.mvpTrybeRun = { ...st, on: false }
    }
    const id = a.url.split('/').pop() as string
    return opts.send ? opts.send(id) : { outcome: 'sent', steps: ['pressed'] }
  }
  const fn = new Function('chrome', 'fetch', 'trybeSend', 'trybeOwnTab', 'TRYBE_CALLERS', 'Date', 'setTimeout', `${RUNNER}; return { trybeRunTick, trybeRunSave, trybeRunState }`)
  const FakeDate = { now: () => clock } as unknown as DateConstructor
  const api = fn(chrome, fetchFake, trybeSend, async () => (opts.noTab ? null : 7), /^https:\/\/(www\.)?mvpaffiliate\.io$/, FakeDate, () => 0)
  await api.trybeRunSave({ on: true, origin: 'https://www.mvpaffiliate.io', ids: opts.ids, idx: 0, sent: 0, failStreak: 0, misses: 0, current: null, busyAt: null, nextAt: 0, startedAt: clock, log: [] })
  // Each tick, then the clock moves to the next wake.
  for (let i = 0; i < 400; i++) {
    await api.trybeRunTick()
    const st = await api.trybeRunState()
    if (!st.on) break
    clock = Math.max(clock + 1, st.nextAt || clock + 1)
  }
  const gapsOk = sends.every((s, i) => i === 0 || s.at - sends[i - 1].at >= (opts.ids.length < 40 ? 10_000 : 45_000))
  return { st: await api.trybeRunState(), results, claims, sends, alarms, gapsOk }
}

async function main() {
  {
    const r = await sim({ ids: ['a', 'b', 'c'] })
    check('a run sends each brand once, in order, and ends Done', r.claims.join() === 'a,b,c' && r.results.map(x => `${x.brandId}:${x.outcome}`).join() === 'a:sent,b:sent,c:sent' && !r.st.on && /Done: 3 sent/.test(r.st.ended || ''), JSON.stringify(r.st.ended))
    check('every send is out of sight', r.sends.length === 3 && r.sends.every(s => s.behind))
  }
  {
    // 1.53.2: no TRYBE tab, nothing claimed, the run says why and stops.
    const r = await sim({ ids: ['a', 'b'], noTab: true })
    check('with no TRYBE tab open nothing is claimed or sent, and the run says to open TRYBE', r.claims.length === 0 && r.sends.length === 0 && /TRYBE is not open in this Chrome\. Open it from MVP's TRYBE page, leave the tab open/.test(r.st.ended || ''))
  }
  {
    const r = await sim({ ids: ['a', 'b', 'c'], claim: (id, n) => n === 1 ? { capped: true, dailyCap: 80, nextFreeAt: '2026-10-17T10:00:00Z' } : { ok: true, name: id, url: `https://jointrybe.com/x/${id}`, message: 'Hi' } })
    check('the daily limit stops the run and says so', r.claims.join() === 'a,b' && r.sends.length === 1 && /All 80 sends/.test(r.st.ended || '') && r.st.nextFreeAt === '2026-10-17T10:00:00Z')
  }
  {
    const r = await sim({ ids: ['a', 'b', 'c', 'd'], send: () => ({ outcome: 'failed', error: 'request-button-not-found' }) })
    check('two failures in a row stop the run', r.sends.length === 2 && /two sends in a row failed/.test(r.st.ended || ''))
  }
  {
    const r = await sim({ ids: ['a', 'b', 'c'], send: () => ({ outcome: 'failed', error: 'needs-screen: brand-not-found' }) })
    check('a send left for Send now is not counted as TRYBE breaking', r.sends.length === 3 && r.results.every(x => x.error?.startsWith('needs-screen')) && /Done: 0 sent/.test(r.st.ended || ''))
  }
  {
    // 1.50.1: a brand SCOUT could not find is not TRYBE breaking, unless four come in a row.
    const r = await sim({ ids: ['a', 'b', 'c'], send: () => ({ outcome: 'failed', error: 'brand-not-found' }) })
    check('three brands not found in a row do not stop the run', r.sends.length === 3 && /Done: 0 sent/.test(r.st.ended || ''))
    const r4 = await sim({ ids: ['a', 'b', 'c', 'd', 'e'], send: () => ({ outcome: 'failed', error: 'brand-not-found' }) })
    check('four in a row stop it, saying TRYBE may have changed its list', r4.sends.length === 4 && /could not find four brands in a row/.test(r4.st.ended || ''))
  }
  {
    const r = await sim({ ids: ['a', 'b', 'c'], stopAfter: 1 })
    check('Stop lets the send under way finish and record, then nothing more starts', r.sends.length === 1 && r.results.length === 1 && r.results[0].outcome === 'sent' && /Stopped\. 1 sent/.test(r.st.ended || ''))
  }
  {
    const r = await sim({ ids: ['a', 'b'], claim: () => 'unreached' })
    check('MVP out of reach three times stops the run, never sends blind', r.sends.length === 0 && /could not reach MVP three times/.test(r.st.ended || ''))
  }
  {
    const r = await sim({ ids: Array.from({ length: 45 }, (_, i) => `b${i}`) })
    check('a long run waits 45 seconds or more between sends, with an alarm', r.results.length === 45 && r.alarms.length >= 44 && r.alarms.every(a => a.name === 'mvp-trybe-run') && r.gapsOk, JSON.stringify({ n: r.results.length, a: r.alarms.length }))
  }
  // A send cut off by a restart is settled as not confirmed, never sent again.
  {
    const store: Store = { mvpTrybeRun: { on: true, origin: 'https://www.mvpaffiliate.io', ids: ['a', 'b'], idx: 0, sent: 0, failStreak: 0, misses: 0, current: { id: 'a', name: 'A' }, busyAt: 1, nextAt: 0, startedAt: 1, log: [] } }
    const results: Array<{ brandId: string; outcome: string }> = []
    const sent: string[] = []
    const chrome = { storage: { local: { get: async (k: string) => ({ [k]: JSON.parse(JSON.stringify(store[k])) }), set: async (o: Store) => { Object.assign(store, JSON.parse(JSON.stringify(o))) } } }, alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } }, runtime: { onStartup: { addListener: () => {} } } }
    const fetchFake = async (_u: string, init: { body: string }) => { const b = JSON.parse(init.body); if (b.action === 'result') results.push({ brandId: b.brandId, outcome: b.outcome }); return { ok: true, status: 200, json: async () => (b.action === 'claim' ? { ok: true, name: b.brandId, url: `https://jointrybe.com/x/${b.brandId}`, message: 'Hi' } : { ok: true }) } }
    const send = async (a: { url: string }) => { sent.push(a.url.split('/').pop() as string); return { outcome: 'sent', steps: ['pressed'] } }
    const api = new Function('chrome', 'fetch', 'trybeSend', 'trybeOwnTab', 'TRYBE_CALLERS', 'Date', 'setTimeout', `${RUNNER}; return { trybeRunTick }`)(chrome, fetchFake, send, async () => 7, /^https:\/\/(www\.)?mvpaffiliate\.io$/, { now: () => 10_000_000 }, () => 0)
    await api.trybeRunTick()
    check('a send cut off by a restart is not confirmed, and the next brand goes', results[0]?.brandId === 'a' && results[0]?.outcome === 'unconfirmed' && sent.join() === 'b', JSON.stringify({ results, sent }))
  }

  // ── MVP's page ──
  check('only MVP\'s own site can start, read or stop a run', /if \(\/\^MVP_\(TRYBE\|HASHTAG\)_\/\.test\(msg\.type\) && !trybeCallerOk\(sender\)\)/.test(BG) && /msg\.type === 'MVP_TRYBE_RUN'/.test(BG) && /msg\.type === 'MVP_TRYBE_RUN_STOP'/.test(BG))
  check('Send all hands the list to SCOUT when SCOUT can run it', /if \(usesRunner\) \{ await startRunner\(list, 'Send all'\); return \}/.test(UI) && /scoutAtLeast\(scoutVersion, SCOUT_TRYBE_RUNNER_MIN_VERSION\)/.test(UI))
  check('the page says the tab can close and nothing takes the screen', /You can close this tab or keep working\. Nothing takes your screen/.test(UI))
  check('Stop stops SCOUT\'s run', /if \(scoutRun\?\.on\) \{ const r = await requestTrybeRunStop\(\)/.test(UI))
  check('an older SCOUT\u2019s out of sight miss says so in words, and that Send now tries again', /needs-screen: [\s\S]{0,40}SCOUT could not reach it out of sight/.test(UI) && /Press Send now on it to try again/.test(UI))
  check('a Send now never runs beside SCOUT\'s own run', /if \(scoutRun\?\.on\) \{ toast\.message\('SCOUT is sending your list right now/.test(UI))

  if (fails.length) { console.error('trybe-runner failed:\n - ' + fails.join('\n - ')); process.exit(1) }
  console.log('✅ trybe-runner: SCOUT runs Send all by itself, out of sight, on MVP\'s pacing and limits; MVP\'s tab can close')
}
void main()
