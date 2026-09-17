// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// DROP THE PACK CACHE THE LANE IS STILL CARRYING.
//
// Turning webpack's production filesystem cache off (see next.config.ts,
// build-cache-bust-4) stops us WRITING a 1.2 GB pack cache. It does not remove
// the one already sitting in the lane.
//
// Vercel restores .next/cache before the build and saves it again after, and
// `next build` never deletes it, that being the whole point of a cache. So
// without this step the oversized directory is restored, ignored, and saved
// again, every build, for as long as the project exists. The build would be
// fine and the lane would stay broken, which is the shape of bug this codebase
// keeps finding: the thing works and the report says so while the actual
// artefact never changes.
//
// One build with this in front of it and the lane's cache is empty.
//
// Only .next/cache/webpack goes. fetch-cache and swc are tens of kilobytes,
// well under any ceiling, and are genuinely worth keeping between builds.
import { rmSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TARGET = '.next/cache/webpack'

function dirSize(dir: string): number {
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

const before = dirSize(TARGET)

if (before === 0) {
  console.log('   no webpack pack cache to clear')
} else {
  const mb = Math.round(before / 1024 / 1024)
  try {
    rmSync(TARGET, { recursive: true, force: true })
    // Say what happened, not what was attempted. A cleared cache and a cache
    // that refused to delete look identical from the next line of the log.
    const after = dirSize(TARGET)
    if (after === 0) {
      console.log(`   cleared ${mb} MB of stale webpack pack cache`)
    } else {
      console.log(`   could NOT clear the pack cache: ${Math.round(after / 1024 / 1024)} MB still there`)
    }
  } catch (e) {
    console.log(`   could NOT clear the pack cache: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// Never fails the build. A cache that will not delete is worth saying out loud
// and is not worth blocking a deploy over, since nothing reads it anyway.
