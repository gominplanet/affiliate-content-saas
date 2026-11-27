// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE STAYS READY (SCOUT 1.61.0; Seb, 2026-11-27: "We really have to figure
// out how to get MVP to stop always asking for tribe connection. We get a lot
// of 401s ... Once the user logs into Tribe once, MVP should be able to do
// everything it needs to").
//
// The cause, read in SCOUT 1.60.13: TRYBE's sign-in lasts an hour and TRYBE's
// page stops renewing it while its tab is in the background, so SCOUT sent an
// hour-old sign-in (a 401), and every refused request reloaded the TRYBE tab
// on its own, cutting off the others.
//
// Here SCOUT's own in-page code runs against a made-up TRYBE page: a sign-in
// that has run out is never sent, the freshest one is, and how long it has
// left is read without the sign-in leaving the page. Then the renewal is
// checked to be one for everyone, after the requests in the tab finish, and
// the background check to keep it fresh with no new permissions.

import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { SCOUT_LATEST_VERSION } from '../lib/scout-version'
import { SCOUT_RELEASES } from '../lib/scout-news'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: unknown) => { if (!ok) failures.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const BG = readFileSync('extension/background.js', 'utf8')
const MANIFEST = JSON.parse(readFileSync('extension/manifest.json', 'utf8'))

/** One whole function from SCOUT, by name, as Chrome would copy it. */
function fnSrc(name: string): string {
  const i = BG.indexOf(`function ${name}(`)
  if (i < 0) return ''
  const start = BG.lastIndexOf('\n', i) + 1
  let depth = 0
  // The body's brace, after the parameters (which can hold braces of their own).
  const body = BG.slice(i).search(/\)\s*\{/)
  for (let k = i + body + BG.slice(i + body).indexOf('{'); k < BG.length; k++) {
    if (BG[k] === '{') depth++
    else if (BG[k] === '}') { depth--; if (depth === 0) return BG.slice(start, k + 1) }
  }
  return ''
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (secondsLeft: number) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + secondsLeft, sub: 'creator' })}.sig`

/** A made-up TRYBE page: its storage, its cookie, and a fetch that answers
 *  with the sign-in it was sent. */
function page(o: { watcher?: string; local?: string; cookie?: string }) {
  const sent: Array<string | null> = []
  const store: Record<string, string> = o.local ? { 'sb-abc-auth-token': JSON.stringify({ access_token: o.local }) } : {}
  const ctx = {
    window: { __mvpTrybeAuth: o.watcher ? { token: o.watcher } : undefined, scrollTo() {} },
    localStorage: { get length() { return Object.keys(store).length }, key: (i: number) => Object.keys(store)[i] ?? null, getItem: (k: string) => store[k] ?? null },
    document: {
      cookie: o.cookie ? `other=1; sb-abc-auth-token=${encodeURIComponent('base64-' + Buffer.from(JSON.stringify({ access_token: o.cookie })).toString('base64'))}` : 'other=1',
      readyState: 'complete', body: { scrollHeight: 100, innerText: 'x'.repeat(200) }, querySelector: () => null, querySelectorAll: () => [],
    },
    location: { pathname: '/creator/discover' },
    getComputedStyle: () => ({ overflowY: 'visible' }),
    atob: (x: string) => Buffer.from(x, 'base64').toString('binary'),
    TextDecoder, Uint8Array, JSON, Math, Number, String, Object, Array, Date, Promise,
    // Fast clock for the page's own waits.
    setTimeout: (fn: () => void) => setImmediate(fn),
    fetch: async (_path: string, init: { headers: Record<string, string> }) => {
      sent.push(init.headers.authorization ?? null)
      return { ok: true, status: 200, text: async () => JSON.stringify({ hello: 'trybe' }) }
    },
  }
  ;(ctx.window as Record<string, unknown>).window = ctx.window
  vm.createContext(ctx)
  const api = vm.runInContext(`(${fnSrc('trybeApiInPage').replace(/^async function trybeApiInPage/, 'async function')})`, ctx)
  const left = vm.runInContext(`(${fnSrc('trybeSignInLeftInPage').replace(/^function trybeSignInLeftInPage/, 'function')})`, ctx)
  // The page's own globals the functions read as bare names.
  vm.runInContext('var __w = window; localStorage; document; location;', ctx)
  return { api: () => api('GET', '/backend/api/profile', null), left: () => left(), sent }
}

async function main() {
  check('SCOUT has both in-page functions, each alone', fnSrc('trybeApiInPage').length > 500 && fnSrc('trybeSignInLeftInPage').length > 300)

  const old = jwt(-600), fresh = jwt(3000), fresher = jwt(3500)
  {
    const p = page({ watcher: old, local: fresh })
    const r = await p.api()
    check('an hour-old sign-in noted from the page is not sent; the fresh stored one is', r.ok === true && p.sent.length === 1 && p.sent[0] === `Bearer ${fresh}` && r.tokenFrom === 'stored', { r, sent: p.sent })
  }
  {
    const p = page({ watcher: old, local: old })
    const r = await p.api()
    check('every sign-in run out: nothing goes to TRYBE (never a 401), and SCOUT is told to renew', r.ok === false && r.error === 'sign-in-expired' && r.status === 0 && p.sent.length === 0, { r, sent: p.sent })
  }
  {
    const p = page({ watcher: fresher, cookie: fresh })
    const r = await p.api()
    check('the freshest sign-in is sent, wherever it is kept', p.sent[0] === `Bearer ${fresher}` && r.tokenFrom === 'page', { sent: p.sent })
  }
  {
    const p = page({ cookie: fresh })
    const r = await p.api()
    check('TRYBE’s cookie copy is read when that is the only one', r.ok === true && p.sent[0] === `Bearer ${fresh}`)
  }
  {
    const p = page({ local: fresh, watcher: old })
    const l = p.left()
    check('how long the sign-in has left is read, and the sign-in itself never leaves the page', l.signin === false && l.left > 2900 && l.left <= 3000 && !JSON.stringify(l).includes(fresh), l)
    check('no sign-in at all: none left', page({}).left().left === null)
  }

  // ── One renewal for everyone ────────────────────────────────────────────────
  const api = fnSrc('trybeApi')
  check('a request whose sign-in ran out, or was refused, waits on the one renewal and is asked once more', /res\.error === 'sign-in-expired' \|\| res\.status === 401/.test(api) && /const renewed = await trybeRenew\(tabId\)/.test(api) && /if \(renewed === 'renewed'\) res = await trybeRunCounted\(trybeApiInPage, args, tabId\)/.test(api))
  check('signed out only when TRYBE shows its sign-in page', /else if \(renewed === 'signed-out'\) res = \{ ok: false, status: 401, error: 'not-signed-in'/.test(api) && /if \(now && now\.signin\) return 'signed-out'/.test(fnSrc('trybeRenew')))
  const renew = fnSrc('trybeRenew')
  check('one renewal at a time, shared by every request waiting', /if \(trybeRenewing\) return trybeRenewing/.test(renew) && /\.finally\(\(\) => \{ trybeRenewing = null \}\)/.test(renew))
  check('the requests already in the tab finish before it reloads', /\(trybeBusyIn\.get\(tabId\) \|\| 0\) > 0/.test(renew) && renew.indexOf('trybeBusyIn') < renew.indexOf('trybeOwnTabRefresh'))
  check('never reloaded while the creator looks at it', /await trybeOwnTabRefresh\(tabId\)/.test(renew) && /if \(t\.active && w\.focused\) return false/.test(fnSrc('trybeOwnTabRefresh')))
  check('a page still loading renews by itself before any reload', renew.indexOf('!now.ready') > 0 && renew.indexOf('!now.ready') < renew.indexOf('trybeOwnTabRefresh'))
  check('the brand list read renews first when the sign-in is about to run out', /await trybeFreshFirst\(tabId\)\)\s*===\s*'signed-out'/.test(fnSrc('trybeHarvest')))

  // ── Kept fresh in the background ────────────────────────────────────────────
  const keep = fnSrc('trybeKeepFresh')
  check('every 15 minutes, a sign-in with under 25 minutes left is renewed', /periodInMinutes: 15/.test(BG) && /st\.left < 25 \* 60\) await trybeRenew\(id\)/.test(keep))
  check('the alarm is made once, not reset each time SCOUT wakes', /const have = await chrome\.alarms\.get\(TRYBE_FRESH_ALARM\); if \(!have\) chrome\.alarms\.create/.test(BG))
  check('TRYBE reopened behind only for a creator working in MVP who used TRYBE from it, signed in', /14 \* 86400000/.test(keep) && /\|\| !signed\) return/.test(keep) && /if \(!mvp\.length\) return/.test(keep) && /await trybeOpenBehind\(mvp\[0\]\.id, false\)/.test(keep))
  check('opened behind, TRYBE is pinned; opened for the creator, it is not', /active: !!focus, pinned: !focus/.test(fnSrc('trybeOpenBehind')))
  check('no new permissions: alarms and tabs, as before', JSON.stringify(MANIFEST.permissions) === JSON.stringify(['activeTab', 'scripting', 'storage', 'tabs', 'downloads', 'alarms']) && !MANIFEST.permissions.includes('cookies'))

  // ── MVP asks only for what only the creator can do ─────────────────────────
  const GATE = readFileSync('components/labs/TrybeTabGate.tsx', 'utf8')
  const OUT = readFileSync('components/labs/TrybeOutreach.tsx', 'utf8')
  check('no pop-up while SCOUT opens TRYBE by itself, nor when SCOUT did not say', /const scoutOpensIt = inBackground && state === 'closed' && \(holdPopup \|\| !openTried\)/.test(GATE) && /const askNow = needed && !scoutOpensIt && state !== 'unknown'/.test(GATE) && /if \(!askNow\) \{ setPop\(false\); return \}/.test(GATE))
  check('while it opens, the card says so in one quiet line', /if \(scoutOpensIt\) return <p/.test(GATE) && /SCOUT is opening TRYBE in a tab behind this one\. Nothing to do here\./.test(GATE))
  check('the TRYBE page tells the gate once SCOUT has tried', /setAutoOpening\(false\); setOpenTried\(true\)/.test(OUT) && /openTried=\{openTried\}/.test(OUT))

  // ── Released ────────────────────────────────────────────────────────────────
  check('SCOUT 1.61.0 everywhere it is named', MANIFEST.version === '1.61.0' && SCOUT_LATEST_VERSION === '1.61.0' && SCOUT_RELEASES[0]?.version === '1.61.0' && /Latest release: \*\*1\.61\.0\*\*/.test(readFileSync('extension/CHROME-WEB-STORE.md', 'utf8')))
  check('no dashes in what members read', !/[–—]/.test(SCOUT_RELEASES[0]?.notes.map((n) => n.text).join(' ') || ''))

  if (failures.length) {
    console.error(`test-trybe-signin: ${failures.length} failed`)
    for (const f of failures) console.error(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('test-trybe-signin: a run-out TRYBE sign-in is never sent, one renewal for everyone, kept fresh in the background, no new permissions')
}
void main()
