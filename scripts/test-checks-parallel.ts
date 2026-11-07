// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE CHECKS RUN SIDE BY SIDE, AND ALL OF THEM STILL RUN (Seb, 2026-10-28:
// deploys took too long). Pinned: the build runs scripts/run-checks.mjs
// before the site is built, the list it runs is package.json's "checks",
// every entry names a real script, and a failing check stops the deploy.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
const R = readFileSync('scripts/run-checks.mjs', 'utf8')

check('the build runs every check before building the site', /node scripts\/run-checks\.mjs && npm run build:clear-cache && next build$/.test(pkg.scripts.build))
const steps = (pkg.scripts.checks || '').split('&&').map((s) => s.trim()).filter(Boolean)
check('the checks list is all there', steps.length >= 250)
check('every check names a script that exists', steps.every((s) => { const m = s.match(/^npm run ([\w:.-]+)$/); return !m || !!pkg.scripts[m[1]] }))
check('the checks list cannot call itself', !steps.includes('npm run checks') && !/run-checks/.test(pkg.scripts.checks || ''))
check('a failing check stops the deploy with its own output', /failed\.push\(job\.name\)/.test(R) && /if \(failed\.length\) \{[\s\S]*?process\.exit\(1\)/.test(R) && /\$\{out\.trim\(\)\}/.test(R))
check('an empty or broken list stops the deploy rather than passing', /nothing was checked'\)\s*\n\s*process\.exit\(1\)/.test(R) && /names a script package\.json does not have`\)\s*\n\s*process\.exit\(1\)/.test(R))
check('the log says how many passed', /all \$\{jobs\.length\} checks passed in \$\{secs\}s/.test(R))

// NOT MORE AT ONCE THAN THE BUILD CAN HOLD (2026-11-07: two deploys in a row
// stopped at about two minutes with no check's output).
check('the count at once is held to the processors and memory the build may really use, and 6', /readFileSync\('\/sys\/fs\/cgroup\/cpu\.max'/.test(R) && /'\/sys\/fs\/cgroup\/memory\.max'/.test(R) && /Math\.min\(cpus, Math\.floor\(memGb \/ 0\.5\), 6\)/.test(R))
check('the log says how many at once and why', /checks, \$\{width\} at a time \(\$\{cpus\} processors/.test(R))
check('a check the system stopped runs again once, on its own, and is said', /if \(!again && \(signal \|\| code === 137 \|\| code === null\)\)/.test(R) && /for \(const job of killed\) await run\(job, true\)/.test(R) && /stopped by the system and run again/.test(R))
check('a check that failed its own tests is never run again', /\} else if \(code !== 0\) \{\s*failed\.push\(job\.name\)/.test(R))

if (fails.length) { console.error('FAIL checks parallel:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('✅ checks-parallel: every check runs, side by side, and any failure stops the deploy')
