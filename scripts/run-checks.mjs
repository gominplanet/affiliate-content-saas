// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// EVERY CHECK, SEVERAL AT ONCE (Seb, 2026-10-28: "I'm not a big fan of how
// it's taking so long for things to deploy"). The build used to run about 300
// checks one after another, each a fresh process taking about 2.5 seconds,
// before the site itself was built: minutes of every deploy spent waiting in
// line. None of them reads what another wrote, so they now run side by side,
// one per processor.
//
// Nothing is skipped. The list is package.json's "checks" script, exactly as
// it would run in a row, and the deploy stops if any one fails, with that
// check's own output printed. The last line says how many passed and how long
// they took, so a quiet log is never mistaken for checks that did not run.
//
// Add a check by appending `&& npm run test:<name>` to "checks".

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const steps = String(pkg.scripts?.checks || '').split('&&').map((s) => s.trim()).filter(Boolean)
if (!steps.length) {
  console.error('run-checks: package.json has no "checks" script, so nothing was checked')
  process.exit(1)
}

// `npm run x` becomes the command it names, so each check skips npm's own
// half second of start-up. Anything else runs as written.
const jobs = steps.map((step) => {
  const m = step.match(/^npm run ([\w:.-]+)$/)
  if (m && !pkg.scripts[m[1]]) {
    console.error(`run-checks: "${step}" names a script package.json does not have`)
    process.exit(1)
  }
  return { name: m ? m[1] : step, cmd: m ? pkg.scripts[m[1]] : step }
})

const width = Math.max(1, Number(process.env.CHECKS_PARALLEL) || (os.availableParallelism?.() ?? os.cpus().length))
const env = { ...process.env, PATH: `${path.resolve('node_modules/.bin')}${path.delimiter}${process.env.PATH ?? ''}` }
const started = Date.now()
const failed = []
let next = 0

function run(job) {
  return new Promise((resolve) => {
    const child = spawn(job.cmd, { shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => {
      if (code !== 0) {
        failed.push(job.name)
        console.error(`\n✗ ${job.name} failed (exit ${code}): ${job.cmd}\n${out.trim()}\n`)
      }
      resolve()
    })
    child.on('error', (e) => { out += String(e) })
  })
}

async function lane() {
  while (next < jobs.length) await run(jobs[next++])
}

await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, lane))
const secs = Math.round((Date.now() - started) / 1000)
if (failed.length) {
  console.error(`run-checks: ${failed.length} of ${jobs.length} checks FAILED in ${secs}s, ${width} at a time: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`run-checks: all ${jobs.length} checks passed in ${secs}s, ${width} at a time`)
