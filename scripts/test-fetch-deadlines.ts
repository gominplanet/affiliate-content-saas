// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Every server-side fetch has a deadline.
//
// Node's fetch has no default timeout. A provider that accepts the connection
// and then goes quiet holds the serverless function open until maxDuration,
// which on the generation routes is 300 seconds. The creator watches a spinner
// that will never resolve, and the function bills for every second of it. A hung
// call is worse than a failed one in every way that matters here: it costs more,
// it says nothing, and it retries nothing.
//
// This walks every fetch call site rather than every file, which matters. An
// earlier count of "roughly 100 unbounded calls" was produced by listing files
// that lacked the fetchWithTimeout import, and most of those files were already
// fine: they pass an inline AbortSignal.timeout at the call. The real number was
// eleven. A check that reads files instead of calls does not measure the thing
// it claims to measure, and reporting from it wasted a morning.
//
// Two forms count as bounded, because both are: fetchWithTimeout, and a fetch
// given its own signal.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const root = new URL('..', import.meta.url).pathname

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const rel = `${dir}/${name}`
    const st = statSync(join(root, rel))
    if (st.isDirectory()) walk(rel, out)
    else if (/\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}

/** Every `await fetch(` whose own call carries no deadline. Spans lines,
 *  because most of these calls are multi-line option objects. */
function unboundedCalls(src: string): number[] {
  const lines = src.split('\n')
  const hits: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/await fetch\(/.test(lines[i])) continue
    let depth = 0, span = '', started = false
    for (let j = i; j < Math.min(i + 25, lines.length); j++) {
      span += lines[j] + '\n'
      for (const ch of lines[j]) {
        if (ch === '(') { depth++; started = true }
        else if (ch === ')') depth--
      }
      if (started && depth <= 0) break
    }
    if (/AbortSignal\.timeout|signal\s*:/.test(span)) continue
    hits.push(i + 1)
  }
  return hits
}

// Server code, plus the shared libs the browser also uses. lib/fetch-timeout
// itself is the one place a bare fetch is correct: it is the implementation.
const files = [...walk('app/api'), ...walk('lib'), ...walk('services')]
  .filter(f => f !== '/lib/fetch-timeout.ts' && !f.endsWith('/lib/fetch-timeout.ts'))

let scanned = 0
for (const f of files) {
  const src = readFileSync(join(root, f), 'utf8')
  if (!/await fetch\(/.test(src)) continue
  scanned++
  for (const line of unboundedCalls(src)) {
    failures.push(`${f.replace(/^\//, '')}:${line} — fetch with no deadline. Use fetchWithTimeout from lib/fetch-timeout, or pass your own AbortSignal.timeout.`)
  }
}

// A scan that silently matched nothing would pass forever. Prove it looked.
if (scanned < 20) {
  failures.push(`the scan only found ${scanned} files containing a fetch, which means it is not looking where it thinks it is`)
}

console.log(failures.length ? `FAIL (${failures.length})` : `ALL PASS (${scanned} files with fetch calls, every call bounded)`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
