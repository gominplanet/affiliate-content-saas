// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A TIMEOUT HAS TO SURVIVE THE TRIP FROM fetch TO THE WORKER.
//
// Three hops, each written correctly, and the first one silently unmade the
// second for eight days:
//
//   fetch-timeout   caught undici's TimeoutError and rethrew `new Error(msg)`
//                   so the log would name the host and the budget. A plain
//                   Error is named "Error".
//   job-runner      recognised a timeout with `e.name === 'TimeoutError'`.
//   cron worker     recognised the runner's tag with /^TIMEOUT/i.
//
// So no self-call timeout was ever tagged, every one took the ordinary-failure
// branch, and that branch REQUEUES. The generate route does not stop when the
// worker hangs up, so the abandoned run published, the retry published again,
// and a creator got three near-identical posts a minute apart on two days.
// generation_jobs recorded a clean "failed" for every one of them.
//
// Nothing could have caught that by reading either file: both were right. What
// was wrong was the join, so this test drives a REAL timed-out fetch against a
// REAL socket that accepts and never answers, and follows the error the whole
// way to the predicate the worker actually calls. No hand-written error shapes
// on the path that matters, because hand-writing the shape is how the seam
// looked fine for eight days.
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fetchWithTimeout, isTimeoutError, TIMEOUT_ERROR_NAME } from '../lib/fetch-timeout'
import { tagIfTimeout, isTaggedTimeout, TIMEOUT_TAG } from '../lib/job-timeout'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** A server that accepts the connection and then says nothing, ever. This is
 *  what the generate route looks like from the worker while it is busy. */
function stalling(): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const sockets: import('node:net').Socket[] = []
    const server: Server = createServer(() => { /* never respond */ })
    server.on('connection', s => sockets.push(s))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/api/blog/generate`,
        close: () => { for (const s of sockets) s.destroy(); server.close() },
      })
    })
  })
}

/** A port with nothing on it, for the case that must NOT read as a timeout. */
function deadPort(): Promise<number> {
  return new Promise(resolve => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function main() {
  // ── the real thing, end to end ────────────────────────────────────────────
  {
    const s = await stalling()
    let caught: unknown = null
    try {
      await fetchWithTimeout(s.url, { method: 'POST', body: '{}', timeoutMs: 1200 })
      check('a stalled request eventually throws', false, 'it returned, so nothing below was exercised')
    } catch (e) { caught = e }
    s.close()

    const err = caught as Error
    check('the error names the host and the budget',
      /127\.0\.0\.1.*timed out after 1s/.test(err?.message ?? ''), err?.message)
    check('and it is still NAMED a timeout after the rewording',
      err?.name === TIMEOUT_ERROR_NAME,
      `name is "${err?.name}" — a plain Error here is the exact bug: every caller testing e.name stops seeing timeouts`)
    check('the module that raised it recognises it', isTimeoutError(err))

    // The seam. This is the hop that was broken.
    const tagged = tagIfTimeout(err, 'blog generation')
    check('the runner tags it', tagged !== null,
      'untagged, the worker requeues a job whose route is still publishing, and the post is written twice')
    check('and the worker reads the tag the runner wrote',
      tagged !== null && isTaggedTimeout(tagged.message), tagged?.message)
    check('the original cause is not thrown away',
      (tagged as { cause?: unknown } | null)?.cause === err,
      'the real message is what tells an operator which host and which budget')
  }

  // ── a caller's own deadline, which is how the worker actually calls ───────
  {
    const s = await stalling()
    let caught: unknown = null
    try {
      await fetchWithTimeout(s.url, { method: 'POST', body: '{}', signal: AbortSignal.timeout(600) })
    } catch (e) { caught = e }
    s.close()

    const err = caught as Error
    check('a caller-signal abort says so', /aborted by its caller's deadline/.test(err?.message ?? ''), err?.message)
    check('and is a timeout too', isTimeoutError(err), err?.message)
    check('and tags', tagIfTimeout(err, 'blog generation') !== null)
  }

  // ── the failure that actually hit production on 2026-09-10 ───────────────
  //
  // "Could not reach www.mvpaffiliate.io (UND_ERR_HEADERS_TIMEOUT)": the socket
  // opened and the route never sent a header. It reads as a transport failure
  // and it is a deadline. That job retried three times.
  {
    const undiciHeaders = new Error('fetch failed', { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } })
    check('a headers timeout is a timeout', isTimeoutError(undiciHeaders))
    check('and tags', tagIfTimeout(undiciHeaders, 'blog generation') !== null,
      'this one is not hypothetical — it was requeued three times in production')

    // Once described, the code is inside the message rather than on a cause.
    const described = new Error('Could not reach www.mvpaffiliate.io (UND_ERR_HEADERS_TIMEOUT)')
    check('and still a timeout once it has been described', isTimeoutError(described))
  }

  // ── the historical shape, which has no name on it at all ─────────────────
  //
  // Recognising this by message is what makes the fix hold for an error that
  // has been re-wrapped somewhere along the way and lost its name again.
  {
    const legacy = new Error('Request to www.mvpaffiliate.io timed out after 30s')
    check('the message alone is enough', isTimeoutError(legacy),
      'the name is the primary signal and the message is the belt; losing both is how this started')
  }

  // ── and the things that MUST NOT read as a timeout ───────────────────────
  //
  // This half matters as much. A job tagged as a timeout is left 'running' for
  // the stale window, so calling an instant failure a timeout means ten minutes
  // of spinner for something that died in two seconds.
  {
    const port = await deadPort()
    let caught: unknown = null
    try {
      await fetchWithTimeout(`http://127.0.0.1:${port}/nope`, { method: 'POST', body: '{}', timeoutMs: 2000 })
    } catch (e) { caught = e }
    const err = caught as Error
    check('a refused connection throws', !!err, 'nothing to test otherwise')
    check('and is NOT a timeout', !isTimeoutError(err),
      `${err?.message} — the route never started, so requeuing is the right answer`)
    check('and does not tag', tagIfTimeout(err, 'blog generation') === null)

    for (const e of [
      new Error('boom'),
      new Error('blog generation returned 500'),
      new Error('PERMANENT: self-call stuck in a redirect loop'),
      null,
      undefined,
      'a string',
    ]) {
      check(`"${String((e as Error)?.message ?? e)}" is not a timeout`, !isTimeoutError(e))
    }
    check('an untagged message is not read as tagged', !isTaggedTimeout('blog generation returned 500'))
  }

  // ── neither end writes the seam by hand any more ─────────────────────────
  //
  // Checked on source because a second literal is exactly what drifted: both
  // ends were correct and no test could see that they had stopped agreeing.
  {
    const strip = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

    const runner = strip(readFileSync('lib/generation-job-runner.ts', 'utf8'))
    const worker = strip(readFileSync('app/api/cron/process-generation-jobs/route.ts', 'utf8'))

    check('the runner produces the tag through the shared module', /tagIfTimeout\(/.test(runner))
    check('and does not test e.name itself', !/name === 'TimeoutError'/.test(runner),
      'that check went blind the moment fetch-timeout started rewording the error')
    check('the worker reads the tag through the shared module', /isTaggedTimeout\(/.test(worker))
    check('and does not re-spell the prefix', !/\/\^TIMEOUT/.test(worker),
      'a regex here and a template literal there is how the two ends drifted apart')
    check('the tag itself is defined once', TIMEOUT_TAG === 'TIMEOUT:')
  }

  if (failures.length) {
    console.error(`\n❌ timeout-chain: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ timeout-chain: a real timed-out fetch is still a timeout when the worker reads it')
}

void main()
