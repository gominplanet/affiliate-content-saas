// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A background render that never reports back gives its monthly render back
// (Seb, 2026-10-13), never twice, and a late success takes it again.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickReservation, stuckWords, STUCK_MARK, STUCK_RENDER_MINUTES } from '../lib/stuck-renders'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const at = '2026-10-13T10:00:00Z'
const r = (id: string, minsBefore: number) => ({ id, created_at: new Date(Date.parse(at) - minsBefore * 60_000).toISOString() })
check('the reservation made just before the clip went to rendering is picked', pickReservation([r('far', 30), r('near', 2), r('mid', 6)], at, new Set()) === 'near')
check('one already given back is not given back again', pickReservation([r('near', 2), r('mid', 6)], at, new Set(['near'])) === 'mid')
check('nothing in the window means nothing given back', pickReservation([r('old', 60)], at, new Set()) === null)
check('a reservation made after the clip went to rendering is not it', pickReservation([r('after', -5)], at, new Set()) === null)
check('the clip says whether the render was given back', /Nothing was used from your monthly renders/.test(stuckWords(true)) && !/Nothing was used/.test(stuckWords(false)) && stuckWords(false).startsWith(STUCK_MARK))
check('the sweep waits past every other limit (15 min render, 25 min page)', STUCK_RENDER_MINUTES >= 30)

const lib = read('lib/stuck-renders.ts')
check('only clips still rendering are marked failed', /\.eq\('id', row\.id\)\.eq\('status', 'rendering'\)/.test(lib))
check('only reserved renders of that creator are given back', /\.eq\('feature', 'shorts_render'\)\.eq\('model', 'reserved'\)/.test(lib) && /\.delete\(\)\.eq\('id', pick\)\.eq\('user_id', row\.user_id\)/.test(lib))
const cron = read('app/api/cron/reconcile-stuck-images/route.ts')
check('the ten minute cron runs the sweep', /stuckRenders = await sweepStuckRenders\(admin\)/.test(cron))
const cb = read('app/api/youtube/shorts/render-callback/route.ts')
check('a late failure gives nothing back twice', /if \(job\.reservationId && !sweptAlready\)/.test(cb))
check('a late success takes the render again', /if \(sweptAlready\) recordUsage\(\{ userId: job\.userId, tier: null, feature: 'shorts_render', model: 'reserved'/.test(cb))

if (failed) { console.error(`\n${failed} stuck render check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
