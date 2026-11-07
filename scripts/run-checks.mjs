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

// HOW MANY AT ONCE. A build machine can report the whole host's processors
// and memory while the build is held to a share of them (a container's
// cgroup limits), and a check is a whole Node process of about half a
// gigabyte. Starting one per reported processor could start dozens at once
// and run the build out of memory, which kills it with no check's output
// (two deploys in a row stopped at about two minutes, 2026-11-07). So the
// count is the smallest of: the processors the build may really use, the
// memory it may really use at half a gigabyte a check, and 6.
function cgroupCpus() {
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/)
    if (quota !== 'max' && Number(period) > 0) return Math.max(1, Math.floor(Number(quota) / Number(period)))
  } catch { /* not cgroup v2, or no limit */ }
  return null
}
function cgroupMemGb() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = readFileSync(f, 'utf8').trim()
      const n = Number(v)
      if (v !== 'max' && Number.isFinite(n) && n > 0 && n < 2 ** 50) return n / 2 ** 30
    } catch { /* not this kind of cgroup */ }
  }
  return null
}
const cpus = cgroupCpus() ?? (os.availableParallelism?.() ?? os.cpus().length)
const memGb = Math.min(cgroupMemGb() ?? Infinity, os.totalmem() / 2 ** 30)
const width = Math.max(1, Number(process.env.CHECKS_PARALLEL) || Math.min(cpus, Math.floor(memGb / 0.5), 6))
console.log(`run-checks: ${jobs.length} checks, ${width} at a time (${cpus} processors, ${memGb.toFixed(1)} GB for this build)`)
const env = { ...process.env, PATH: `${path.resolve('node_modules/.bin')}${path.delimiter}${process.env.PATH ?? ''}` }
const started = Date.now()
const failed = []
// Checks the system stopped (a signal, or exit 137 when memory ran out)
// rather than ones that failed: run again one at a time at the end, said in
// the log. A check that fails its own tests is never run again.
const killed = []
let next = 0

function run(job, again = false) {
  return new Promise((resolve) => {
    const child = spawn(job.cmd, { shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code, signal) => {
      if (!again && (signal || code === 137 || code === null)) {
        killed.push(job)
        console.error(`\n! ${job.name} was stopped by the system (${signal || `exit ${code}`}), not by a failed test: it runs again on its own at the end.`)
      } else if (code !== 0) {
        failed.push(job.name)
        console.error(`\n✗ ${job.name} failed (exit ${code ?? signal}): ${job.cmd}\n${out.trim()}\n`)
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
for (const job of killed) await run(job, true)
if (killed.length) console.log(`run-checks: ${killed.length} check${killed.length === 1 ? ' was' : 's were'} stopped by the system and run again on ${killed.length === 1 ? 'its' : 'their'} own: ${killed.map((j) => j.name).join(', ')}`)
const secs = Math.round((Date.now() - started) / 1000)
if (failed.length) {
  console.error(`run-checks: ${failed.length} of ${jobs.length} checks FAILED in ${secs}s, ${width} at a time: ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`run-checks: all ${jobs.length} checks passed in ${secs}s, ${width} at a time`)
