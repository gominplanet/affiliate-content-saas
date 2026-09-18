// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE THIRD TIME, CAUGHT BY THE BUILD INSTEAD OF BY A CUSTOMER.
//
// One sensible change on 8 September gave every outbound call a 30 second
// deadline. It caused two separate silent outages, nine days apart, both found
// by customers:
//
//   10 Sep  the auto-pilot worker died at 30 seconds on a four minute job,
//           recorded the job failed, and the abandoned route published the post
//           anyway. Auto-pilot looked like it worked and posted to no socials.
//
//   17 Sep  /api/blog/schedule-publish, same cause. Its generate call aborted at
//           30 seconds while generate itself carried on and wrote the draft, so
//           creators got a schedule in the dashboard, a draft on the site, and
//           no row anywhere that would publish it. Found only because a creator
//           logged into his host to see what his own dashboard would not tell
//           him.
//
// Neither was a hard problem to find once looked at. Nothing looked, because
// nothing knew which callers had long-running work. So this checks, on every
// build, and it derives the rule rather than keeping a list: a route declaring
// `maxDuration` longer than the default timeout must not be called internally
// without a deadline.
//
// The scanner is tested against synthetic sources as well as the repo, because
// a guard that silently matches nothing passes forever. Four guards in this
// session's own work turned out to be vacuous when broken deliberately; this
// one asserts it catches the exact call that caused the 17 Sep outage.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DEFAULT_TIMEOUT_MS } from '../lib/fetch-timeout'
import {
  heavyRoutes, findInternalCalls, auditInternalCalls, describeViolation,
  routePathOf, stripComments, type SourceFile,
} from '../lib/internal-call-budget'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

/** Every .ts/.tsx under the given roots. */
function collect(dirs: string[]): SourceFile[] {
  const out: SourceFile[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
      const full = join(dir, e)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(e)) out.push({ path: relative(root, full), source: readFileSync(full, 'utf8') })
    }
  }
  for (const d of dirs) walk(join(root, d))
  return out
}

// ── the scanner does what it claims, on sources built to test it ────────────
{
  const synthetic: SourceFile[] = [
    { path: 'app/api/heavy/route.ts', source: 'export const maxDuration = 600\nexport async function POST() {}' },
    { path: 'app/api/light/route.ts', source: 'export const maxDuration = 10\nexport async function POST() {}' },
    { path: 'app/api/plain/route.ts', source: 'export async function POST() {}' },
  ]
  const routes = heavyRoutes(synthetic)
  check('a route declaring more than the default is heavy',
    routes.some((r) => r.routePath === '/api/heavy'))
  check('a route declaring less than the default is not',
    !routes.some((r) => r.routePath === '/api/light'),
    'it cannot be cut short by a deadline longer than itself')
  check('a route declaring nothing is not',
    !routes.some((r) => r.routePath === '/api/plain'))
  check('the route path is derived from the file path',
    routePathOf('app/api/blog/generate/route.ts') === '/api/blog/generate'
      && routePathOf('lib/not-a-route.ts') === null)

  // THE EXACT SHAPE THAT CAUSED THE 17 SEP OUTAGE: the URL is built into a
  // variable from a template literal, then passed by name. A scanner reading
  // only string literals at the call site walks straight past it.
  const caller: SourceFile = {
    path: 'app/api/caller/route.ts',
    source: [
      "const generateUrl = `${url.protocol}//${url.host}/api/heavy`",
      'const res = await fetchWithTimeout(generateUrl, {',
      "  method: 'POST',",
      "  headers: { 'content-type': 'application/json' },",
      '})',
    ].join('\n'),
  }
  const found = findInternalCalls(caller, routes)
  check('the scanner sees a call whose URL was built into a variable',
    found.length === 1 && found[0].routePath === '/api/heavy',
    `found ${found.length}`)
  check('and reports it as having no budget',
    found[0]?.hasBudget === false)
  check('and names a line somebody can go to',
    found[0]?.line === 2, String(found[0]?.line))

  const fixed: SourceFile = { path: caller.path, source: caller.source.replace("  method: 'POST',", '  timeoutMs: 290_000,\n  signal: AbortSignal.timeout(290_000),\n  method: \'POST\',') }
  check('a call that names a timeout passes',
    findInternalCalls(fixed, routes)[0]?.hasBudget === true)
  const signalOnly: SourceFile = { path: caller.path, source: caller.source.replace("  method: 'POST',", '  signal: AbortSignal.timeout(290_000),\n  method: \'POST\',') }
  check('a signal alone is a named budget too',
    findInternalCalls(signalOnly, routes)[0]?.hasBudget === true,
    'that is what the 10 Sep fix made authoritative')

  // Things that must NOT be flagged, because a guard that cries wolf gets
  // edited out rather than read.
  const lightCall: SourceFile = { path: 'app/api/x/route.ts', source: "await fetchWithTimeout('/api/light', { method: 'POST' })" }
  check('a call to a short route is not flagged',
    findInternalCalls(lightCall, routes).length === 0)
  const prefix: SourceFile = { path: 'app/api/x/route.ts', source: "await fetchWithTimeout('/api/heavyweight-thing', { method: 'POST' })" }
  check('a route path that is merely a prefix of another is not a match',
    findInternalCalls(prefix, routes).length === 0,
    '/api/heavy must not match /api/heavyweight-thing')
  const commented: SourceFile = { path: 'app/api/x/route.ts', source: "// await fetchWithTimeout('/api/heavy', { method: 'POST' })" }
  check('a commented-out call is not a live call',
    findInternalCalls(commented, routes).length === 0)
  check('stripping comments keeps the line numbering',
    stripComments('a\n/* x\ny */\nb').split('\n').length === 4,
    'or every reported line number is wrong')
  const nested: SourceFile = {
    path: 'app/api/x/route.ts',
    source: "await fetchWithTimeout('/api/heavy', { body: JSON.stringify({ a, b }), signal: s })",
  }
  check('arguments are split at the top level, not inside a nested call',
    findInternalCalls(nested, routes)[0]?.hasBudget === true,
    'a naive comma split would lose the signal that follows a JSON.stringify')
}

// ── and the repository is clean ─────────────────────────────────────────────
{
  const files = collect(['app', 'lib', 'services', 'components'])
  check('the scan found source to read',
    files.length > 200, `${files.length} files`)

  const routes = heavyRoutes(files)
  check('the repo really does have long-running routes to protect',
    routes.length > 10, `${routes.length}`)
  check('and the generate route is one of them',
    routes.some((r) => r.routePath === '/api/blog/generate'),
    'if this stops being true the threshold or the parser has drifted')

  // THE REGRESSION ITSELF. Proof the audit would have caught the 17 Sep
  // outage, run against the real file with the fix taken back out.
  const schedulePath = 'app/api/blog/schedule-publish/route.ts'
  const scheduleFile = files.find((f) => f.path === schedulePath)
  check('the schedule-publish route is still where this expects it',
    !!scheduleFile, schedulePath)
  if (scheduleFile) {
    const withoutBudget: SourceFile = {
      path: scheduleFile.path,
      source: scheduleFile.source
        .replace(/\n\s*timeoutMs: GENERATE_BUDGET_MS,/, '')
        .replace(/\n\s*signal: AbortSignal\.timeout\(GENERATE_BUDGET_MS\),/, ''),
    }
    check('the audit catches the call that caused the outage, with its fix removed',
      auditInternalCalls([...files.filter((f) => f.path !== schedulePath), withoutBudget])
        .some((v) => v.file === schedulePath && v.routePath === '/api/blog/generate'),
      'if this cannot be reproduced the guard proves nothing about the real code')
  }

  const violations = auditInternalCalls(files)
  check('no internal call to a long-running route is left on the default deadline',
    violations.length === 0,
    violations.map(describeViolation).join(' | ') || undefined)
}

console.log(failures.length
  ? `FAIL (${failures.length})`
  : `ALL PASS (default deadline ${DEFAULT_TIMEOUT_MS / 1000}s)`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
