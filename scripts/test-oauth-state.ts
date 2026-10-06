// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY CONNECT FLOW USES A RANDOM, ONE-TIME OAUTH STATE.
//
// Every "Connect <platform>" flow used the member's user id (or base64 of it)
// as the OAuth `state`. The callbacks compared it with the session, but a user
// id is guessable and the same state worked forever, so a crafted callback link
// could still plant someone else's account. lib/oauth-state fixes that in one
// place: a 32-byte random state, held with the user id in an httpOnly cookie
// scoped to the callback, burned on first use.
//
// This guard keeps it that way. It unit-tests the helper (random, single use,
// mismatch refused) and checks, by source, that every connect start route mints
// state through the helper and every callback consumes it before trusting
// anything. A new provider added without it fails the build.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  newOAuthState, checkOAuthState, startOAuthState, consumeOAuthState,
  callbackHostRedirect, oauthStateCookieName, OAUTH_STATE_TTL_SECONDS,
  OAUTH_STATE_EXPIRED_MESSAGE,
} from '../lib/oauth-state'

// The helper reads its signing secret at call time, so this is in place first.
process.env.OAUTH_STATE_SECRET ||= 'test-oauth-state-secret'

const failures: string[] = []
const check = (name: string, cond: boolean, why = '') => {
  if (!cond) failures.push(why ? `${name}\n    why: ${why}` : name)
}
const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

async function main() {
  // ── the helper: random ──────────────────────────────────────────────────────
  {
    const states = new Set<string>()
    for (let i = 0; i < 200; i++) states.add(newOAuthState('user-1').state)
    check('200 states are 200 different values', states.size === 200,
      'a repeating state is a guessable state')
    const one = newOAuthState('user-1').state
    check('a state is 32 random bytes in base64url', /^[A-Za-z0-9_-]{43}$/.test(one), `got "${one}"`)
    check('the state is not the user id in any form',
      !one.includes('user-1') && one !== Buffer.from('user-1').toString('base64url'),
      'the old state was the user id, which anyone who knows it can rebuild')
  }

  // ── the helper: matches, and refuses everything else ────────────────────────
  {
    const { state, cookieValue } = newOAuthState('user-1', { rt: '/brand', add: true })
    const ok = checkOAuthState(cookieValue, state)
    check('the matching state is accepted with its user and data',
      ok?.uid === 'user-1' && ok?.data.rt === '/brand' && ok?.data.add === true)
    check('a different state is refused', checkOAuthState(cookieValue, newOAuthState('user-1').state) === null)
    check('a missing state is refused', checkOAuthState(cookieValue, null) === null)
    check('a missing cookie is refused', checkOAuthState(undefined, state) === null)
    check('the user id as state is refused', checkOAuthState(cookieValue, 'user-1') === null)
    const [body, sig] = cookieValue.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), uid: 'victim' })).toString('base64url')
    check('a cookie edited to name someone else is refused', checkOAuthState(`${forged}.${sig}`, state) === null,
      'the cookie is signed so a planted cookie cannot name another member')
    check('an expired cookie is refused',
      checkOAuthState(cookieValue, state, Date.now() + (OAUTH_STATE_TTL_SECONDS + 1) * 1000) === null)
    check('the cookie lives ten minutes', OAUTH_STATE_TTL_SECONDS === 600)
  }

  // ── the helper: single use, through a fake cookie jar ───────────────────────
  {
    const store = new Map<string, { value: string; opts: Record<string, unknown> }>()
    const jar = {
      get: (n: string) => (store.has(n) && store.get(n)!.value !== '' ? { value: store.get(n)!.value } : undefined),
      set: (n: string, value: string, opts: Record<string, unknown>) => { store.set(n, { value, opts }) },
    }
    const cb = 'https://www.mvpaffiliate.io/api/auth/linkedin/callback'
    const state = await startOAuthState('linkedin', 'user-1', cb, { rt: '/x' }, jar)
    const set = store.get(oauthStateCookieName('linkedin'))
    check('the cookie is httpOnly, Secure, SameSite=Lax, scoped to the callback, ten minutes',
      set?.opts.httpOnly === true && set?.opts.secure === true && set?.opts.sameSite === 'lax'
        && set?.opts.path === '/api/auth/linkedin/callback' && set?.opts.maxAge === 600)
    check('the state is not in the cookie name or path', !String(set?.opts.path).includes(state))
    const first = await consumeOAuthState('linkedin', state, cb, jar)
    check('the first callback is accepted', first?.uid === 'user-1' && first?.data.rt === '/x')
    check('the cookie is deleted on use', store.get(oauthStateCookieName('linkedin'))?.opts.maxAge === 0)
    const second = await consumeOAuthState('linkedin', state, cb, jar)
    check('the same callback a second time is refused', second === null, 'state must be single use')

    const s2 = await startOAuthState('pinterest', 'user-1', cb, {}, jar)
    const bad = await consumeOAuthState('pinterest', 'wrong', cb, jar)
    const after = await consumeOAuthState('pinterest', s2, cb, jar)
    check('a mismatched callback is refused AND burns the cookie', bad === null && after === null,
      'a refused attempt must not leave a usable cookie behind')
    const s3 = await startOAuthState('facebook', 'user-1', cb, {}, jar)
    check('a state for one provider does not open another', (await consumeOAuthState('threads', s3, cb, jar)) === null)
  }

  // ── the helper: host hop ────────────────────────────────────────────────────
  {
    const cb = 'https://www.mvpaffiliate.io/api/auth/youtube/callback'
    const same = new Request('https://www.mvpaffiliate.io/api/auth/youtube?returnTo=%2Fonboarding', { headers: { host: 'www.mvpaffiliate.io' } })
    check('no hop when the start is already on the callback host', callbackHostRedirect(same, cb) === null)
    const other = new Request('https://mvpaffiliate.io/api/auth/youtube?returnTo=%2Fonboarding', { headers: { host: 'mvpaffiliate.io' } })
    const hop = callbackHostRedirect(other, cb)
    check('a start on the other host hops to the callback host, keeping its query',
      !!hop && hop.startsWith('https://www.mvpaffiliate.io/api/auth/youtube?') && hop.includes('returnTo=%2Fonboarding') && hop.includes('oauth_host=1'),
      `got ${hop}`)
    check('the hop never loops', callbackHostRedirect(new Request(hop || 'https://x/', { headers: { host: 'mvpaffiliate.io' } }), cb) === null)
  }

  // ── the member-facing refusal ───────────────────────────────────────────────
  check('the refusal text has no dashes as sentence breaks', !/[\u2013\u2014]| - /.test(OAUTH_STATE_EXPIRED_MESSAGE))
  check('the refusal text tells the member what to do', /press Connect again/.test(OAUTH_STATE_EXPIRED_MESSAGE))

  // ── every connect flow uses it ──────────────────────────────────────────────
  // Discovered, not listed: every app/api/auth/<provider>/ with a callback/,
  // plus the WordPress one-click connect. A new provider is covered on arrival.
  const flows: Array<{ start: string; callback: string; provider: string }> = []
  for (const p of readdirSync(join(root, 'app/api/auth'))) {
    const start = `app/api/auth/${p}/route.ts`
    const callback = `app/api/auth/${p}/callback/route.ts`
    if (existsSync(join(root, start)) && existsSync(join(root, callback))) flows.push({ start, callback, provider: p })
  }
  flows.push({ start: 'app/api/wordpress/oauth-start/route.ts', callback: 'app/api/wordpress/oauth-callback/route.ts', provider: 'wordpress' })
  const expected = ['facebook', 'gsc', 'instagram', 'linkedin', 'pinterest', 'threads', 'tiktok', 'twitter', 'wordpress', 'youtube']
  for (const p of expected) check(`the ${p} connect flow is found`, flows.some(f => f.provider === p))

  // Comments quote the old code, so read code only.
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

  for (const { start, callback, provider } of flows) {
    const s = code(read(start))
    const c = code(read(callback))
    check(`${start} mints state with startOAuthState('${provider}', ...)`,
      new RegExp(`startOAuthState\\(\\s*'${provider}'`).test(s),
      'a state made any other way is guessable or reusable')
    check(`${start} does not use the user id as state`,
      !/set\('state',\s*(user\.id|Buffer)/.test(s) && !/state:\s*(user\.id|Buffer)/.test(s) && !/state\s*=\s*(user\.id|Buffer\.from\(user)/.test(s))
    if (provider !== 'wordpress') {
      // WordPress builds its callback from the request host, so it never hops.
      check(`${start} starts on the callback's host`, /callbackHostRedirect\(/.test(s),
        'apex and www keep separate cookies; a cookie set on the other host never reaches the callback')
    }
    const consumeAt = c.search(new RegExp(`consumeOAuthState\\(\\s*'${provider}'`))
    check(`${callback} consumes state with consumeOAuthState('${provider}', ...)`, consumeAt > 0,
      'a callback that does not consume the cookie can be replayed')
    const getUserAt = c.indexOf('auth.getUser()')
    check(`${callback} consumes state before anything else trusts the request`,
      consumeAt > 0 && getUserAt > consumeAt,
      'the cookie must be burned before the session lookup, token exchange or any save')
    check(`${callback} still requires the state's user to be the session user`,
      /(stateUserId|userId)\s*!==\s*user\.id/.test(c) || /sessionUser\.id\s*!==\s*state\.userId/.test(c))
    check(`${callback} tells the member in words when it refuses`, /OAUTH_STATE_EXPIRED_MESSAGE/.test(c))
    check(`${callback} no longer decodes a user id out of state`, !/Buffer\.from\(state,/.test(c) && !/verifyState\(/.test(c))
  }

  // Nothing anywhere else in the app hands a provider a state of its own.
  {
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel) }
        else if (/\.tsx?$/.test(e.name)) {
          const src = code(read(rel))
          if (/searchParams\.set\(\s*'state'/.test(src) && !/startOAuthState\(/.test(src)) hits.push(rel)
        }
      }
    }
    walk('app')
    check('no other route sets an OAuth state without the helper', hits.length === 0, hits.join(', '))
  }

  // X keeps PKCE working: the verifier rides in the state cookie now.
  {
    const s = code(read('app/api/auth/twitter/route.ts'))
    const c = code(read('app/api/auth/twitter/callback/route.ts'))
    check('X start stores the PKCE verifier with the state', /startOAuthState\('twitter'[^)]*\{\s*v:\s*codeVerifier\s*\}/.test(s))
    check('X callback exchanges the code with the verifier from the state cookie',
      /verified\?\.data\.v/.test(c) && /exchangeCodeForToken\(code,\s*codeVerifier/.test(c))
  }
}

main().then(() => {
  console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(failures.length ? 1 : 0)
}).catch(e => { console.error(e); process.exit(1) })
