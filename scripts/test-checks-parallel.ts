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

if (fails.length) { console.error('FAIL checks parallel:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('✅ checks-parallel: every check runs, side by side, and any failure stops the deploy')
