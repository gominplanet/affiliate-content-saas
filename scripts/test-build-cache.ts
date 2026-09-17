// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BUILD THAT GRINDS FOR 46 MINUTES AND DIES SAYS NOTHING ABOUT WHY.
//
// Production sat on bc86968 while four commits queued behind it. Two builds
// errored, two were still "Building" at 27 and 37 minutes, and the deploy list
// gave one word for all of it. Meanwhile the same commit built green from a
// deleted .next in 3m36 on an ordinary container.
//
// The difference was the one piece of state Vercel carries between builds and a
// local build does not:
//
//   .next/cache/webpack      1.2 GB
//   .next/cache/fetch-cache   24 KB
//   .next/cache/swc           12 KB
//
// Vercel's build cache ceiling is 1 GB. Past it, what comes back is a fragment,
// and deserializing a fragment of a webpack pack cache is slower than compiling
// from nothing. A build killed at the 45 minute ceiling mid-write leaves the
// next one a worse fragment, which is why this has now happened twice and why
// bumping the cache-bust marker only bought time: the cache crosses 1 GB again
// on the very first build after the bust.
//
// So the production filesystem cache is off. Three ways that can quietly come
// undone, and all three end in the same 46 minute silence:
//
//   turned back on      by someone chasing a faster build, which is the trade
//                       that caused this
//   turned off for DEV  too, which nobody notices in CI and everybody feels on
//                       their own machine
//   kept, reason lost   the next person reads `config.cache = false`, finds no
//                       reason, and deletes it
//
// The size is printed on every build whether or not anything is wrong. An
// invisible 1.2 GB is how this ran for two outages without being named.
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const RAW = readFileSync('next.config.ts', 'utf8')
const CONFIG = RAW
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

// Vercel's documented build cache ceiling, and the number the comment in
// next.config.ts has to keep agreeing with.
const CEILING_BYTES = 1024 * 1024 * 1024

// ── the production cache is off, and dev's is not ─────────────────────────
{
  check('the config takes a webpack hook at all', /webpack\(config, \{ dev \}\)/.test(CONFIG),
    'without one there is nowhere to turn the filesystem cache off')

  check('production builds keep no filesystem cache',
    /if \(!dev\) config\.cache = false/.test(CONFIG),
    'this is the whole fix; with it gone the 1.2 GB pack cache comes back and so does the 46 minute build')

  // The `!dev` is load-bearing in the other direction too.
  check('and dev keeps its own',
    !/^\s*config\.cache = false/m.test(CONFIG),
    'an unconditional disable makes every local rebuild pay full price, which nobody sees in CI')
}

// ── the reason survives, because a bare `false` invites deletion ──────────
{
  check('the measurement is written down', /1\.2 GB/.test(RAW),
    'the size is the evidence; without it this reads as superstition')
  check('and what it is measured against', /1 GB/.test(RAW) && /ceiling/i.test(RAW),
    'a cache being large is not a problem until it is compared to the limit')
  check('the cost of the fix is stated too', /51 second|51s/.test(RAW),
    'a fix whose price is not written down gets reverted by the first person who wonders')
}

// ── the cache-bust marker still matches its own note ──────────────────────
//
// Three of these have been bumped now. The marker and the newest entry drifting
// apart would leave the file arguing with itself.
{
  const marker = RAW.match(/build-cache-bust-(\d+)/)
  check('there is a cache-bust marker', !!marker, 'nothing to invalidate a poisoned lane with')
  if (marker) {
    const n = Number(marker[1])
    check(`bust-${n} has a note of its own`,
      new RegExp(`bust-${n}[.\\s]`).test(RAW),
      'a bumped number with no entry is a bump nobody can explain later')
  }
}

// ── and the size is reported out loud, every build ────────────────────────
//
// Fails only in the state that caused the outage: a cache over the ceiling AND
// the config asking for it to be kept. A restored fragment on a build that is
// about to ignore it is not a reason to stop.
{
  const dirSize = (dir: string): number => {
    let total = 0
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return 0 }
    for (const e of entries) {
      const p = join(dir, e)
      try {
        const s = statSync(p)
        total += s.isDirectory() ? dirSize(p) : s.size
      } catch { /* vanished mid-walk; nothing to add */ }
    }
    return total
  }

  const bytes = dirSize('.next/cache/webpack')
  const gb = (bytes / 1024 / 1024 / 1024).toFixed(2)
  const keptInProduction = !/if \(!dev\) config\.cache = false/.test(CONFIG)

  if (bytes === 0) {
    console.log('   webpack build cache on disk: none')
  } else {
    console.log(`   webpack build cache on disk: ${gb} GB (Vercel stores at most 1.00 GB)`)
    if (bytes > CEILING_BYTES) {
      console.log('   over the ceiling, so only a fragment of it can be restored')
    }
  }

  check('a cache over the ceiling is not also being kept',
    !(bytes > CEILING_BYTES && keptInProduction),
    `${gb} GB of pack cache with production caching still on is exactly the loop that stalled four deploys`)
}

if (failures.length) {
  console.error(`\n❌ build-cache: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ build-cache: production carries no pack cache, dev keeps its own, and the size is said out loud')
