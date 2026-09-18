// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH OF OUR OWN ROUTES ARE WE CALLING WITH A DEADLINE TOO SHORT FOR THEM?
//
// On 8 September, fetchWithTimeout gained a 30 second default so that a hung
// WordPress site could not pin a request open forever. Correct, and it silently
// capped every caller that had not named a deadline of its own, including two
// internal calls to routes that legitimately run for four minutes.
//
//   10 Sep  the auto-pilot worker. Every generation job died at 30 seconds,
//           retried three times, and recorded a failure, while the route it had
//           abandoned carried on server-side and published the post. Auto-pilot
//           looked like it worked and posted to no socials at all, for days.
//
//   17 Sep  /api/blog/schedule-publish, found only because a creator went into
//           his host to see why nothing was publishing. Same cause, nine days
//           later, and the 10 Sep fix could not reach it because that fix taught
//           fetchWithTimeout to respect a caller's signal and this caller had
//           never named one.
//
// Two silent outages from one sensible change, both found by customers, because
// nothing checked which callers had long-running work. That is what this is.
//
// THE RULE, and it needs no list to maintain: a route that declares
// `maxDuration` is telling us how long it may take. If that is longer than the
// default timeout, every internal call to it must name its own budget. The
// threshold is derived from DEFAULT_TIMEOUT_MS, so raising or lowering the
// default automatically changes which routes this covers.

import { DEFAULT_TIMEOUT_MS } from '@/lib/fetch-timeout'

export interface SourceFile { path: string; source: string }

export interface HeavyRoute {
  /** The URL path, e.g. /api/blog/generate */
  routePath: string
  /** Seconds, as the route declares it. */
  maxDuration: number
}

export interface InternalCall {
  file: string
  /** The route being called. */
  routePath: string
  /** fetchWithTimeout | fetch */
  fn: string
  /** Did the caller name a deadline of its own? */
  hasBudget: boolean
  /** 1-indexed line of the call, for a message somebody can act on. */
  line: number
}

/** Comments removed, so a route path mentioned in prose is not read as a call
 *  and a call commented out is not read as live. Replaced with spaces rather
 *  than deleted so line numbers survive. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // Only a `//` preceded by whitespace or the start of a line. The first
    // version required merely that the previous character was not a colon, and
    // it ate the rest of the line from the `//` in
    // `${url.protocol}//${url.host}/api/blog/generate` — blinding this scanner
    // to the exact call it was written to catch. A comment written with no
    // space before it is missed instead, which costs nothing.
    .replace(/(^|\s)\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

/** app/api/blog/generate/route.ts → /api/blog/generate */
export function routePathOf(filePath: string): string | null {
  const m = filePath.replace(/\\/g, '/').match(/(?:^|\/)(app\/api\/.+?)\/route\.tsx?$/)
  return m ? `/${m[1].slice('app/'.length)}` : null
}

/**
 * Every route that declares it may run longer than an unnamed call would wait.
 *
 * Derived, not listed. A route with `maxDuration = 600` is stating that it may
 * take ten minutes; calling it with the 30 second default is a contradiction the
 * caller cannot see, because the short deadline simply wins.
 */
export function heavyRoutes(files: SourceFile[], defaultTimeoutMs = DEFAULT_TIMEOUT_MS): HeavyRoute[] {
  const out: HeavyRoute[] = []
  for (const f of files) {
    const routePath = routePathOf(f.path)
    if (!routePath) continue
    const m = stripComments(f.source).match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)
    if (!m) continue
    const maxDuration = Number(m[1])
    if (maxDuration * 1000 > defaultTimeoutMs) out.push({ routePath, maxDuration })
  }
  // Longest path first, so /api/blog/generate-x is matched before /api/blog/generate.
  return out.sort((a, b) => b.routePath.length - a.routePath.length)
}

/** Read a balanced parenthesised argument list starting at the '(' index. */
function readCallArgs(src: string, open: number): string | null {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/** Split a call's arguments at the top level, so `fetch(url, { a: b(c, d) })`
 *  yields two parts and not three. */
function splitTopLevel(args: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < args.length; i++) {
    const c = args[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { parts.push(args.slice(start, i)); start = i + 1 }
  }
  parts.push(args.slice(start))
  return parts
}

/** Does this text name a route, as a whole path segment rather than a prefix? */
function mentionsRoute(text: string, routePath: string): boolean {
  const i = text.indexOf(routePath)
  if (i === -1) return false
  const after = text[i + routePath.length]
  // End of string, a quote, a query, a further segment, or a template brace.
  return after === undefined || !/[A-Za-z0-9_-]/.test(after)
}

/**
 * Find every call in this file that targets one of the heavy routes.
 *
 * Resolves ONE level of variable indirection, because the real call that caused
 * the 17 Sep outage was written as
 *   `const generateUrl = \`${url.protocol}//${url.host}/api/blog/generate\``
 * and a scanner that only reads string literals at the call site would have
 * walked straight past it. A guard that cannot see the bug it was written for
 * is worse than no guard.
 */
export function findInternalCalls(file: SourceFile, routes: HeavyRoute[]): InternalCall[] {
  const src = stripComments(file.source)
  const out: InternalCall[] = []
  const callRe = /\b(fetchWithTimeout|fetch)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(src))) {
    const args = readCallArgs(src, m.index + m[0].length - 1)
    if (args === null) continue
    const parts = splitTopLevel(args)
    const targetExpr = (parts[0] ?? '').trim()
    const opts = parts.slice(1).join(',')

    // The target, with one level of `const x = ...` resolved.
    let targetText = targetExpr
    if (/^[A-Za-z_$][\w$]*$/.test(targetExpr)) {
      const decl = src.match(new RegExp(`\\b(?:const|let|var)\\s+${targetExpr}\\s*=\\s*([^\\n]+)`))
      if (decl) targetText += '\n' + decl[1]
    }

    const route = routes.find((r) => mentionsRoute(targetText, r.routePath))
    if (!route) continue

    out.push({
      file: file.path,
      routePath: route.routePath,
      fn: m[1],
      // A signal or an explicit timeoutMs both count: either one means somebody
      // thought about how long this takes.
      // `signal,` shorthand counts as much as `signal: x`. Requiring the colon
      // reported lib/blog-generate-client as a violation when it passes both by
      // shorthand, and a guard that cries wolf gets edited out rather than read.
      hasBudget: /(^|[{,\s])(timeoutMs|signal)\s*(:|,|\}|$)/.test(opts),
      line: src.slice(0, m.index).split('\n').length,
    })
  }
  return out
}

/** Every internal call to a long-running route that named no deadline. */
export function auditInternalCalls(files: SourceFile[]): InternalCall[] {
  const routes = heavyRoutes(files)
  const calls: InternalCall[] = []
  for (const f of files) {
    // Client components are out of scope: a browser fetch is not subject to
    // fetchWithTimeout's default unless it opts in, and a page that awaits its
    // own generation for four minutes is doing so deliberately.
    if (/^\s*['"]use client['"]/m.test(f.source)) continue
    calls.push(...findInternalCalls(f, routes))
  }
  return calls.filter((c) => !c.hasBudget)
}

/** One line per violation, naming the file, the route and what to do. */
export function describeViolation(c: InternalCall): string {
  return `${c.file}:${c.line} calls ${c.routePath} with no timeoutMs and no signal, so it inherits the ${DEFAULT_TIMEOUT_MS / 1000}s default`
}
