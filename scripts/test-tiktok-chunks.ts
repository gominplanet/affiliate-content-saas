// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TikTok's chunk rules (Seb, 2026-10-13: "The chunk size is invalid" on a
// 3:41 clip). Every plan must be one TikTok accepts.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { planChunks, MB } from '../lib/tiktok-chunks'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}

/** TikTok's rules for one plan. */
function valid(size: number): string | null {
  const p = planChunks(size)
  if (p.count !== p.ranges.length) return 'count and ranges differ'
  if (p.count === 1) return size <= 64 * MB && p.chunkSize === size ? null : 'one chunk over 64 MB'
  if (p.chunkSize < 5 * MB || p.chunkSize > 64 * MB) return 'chunk size out of 5 to 64 MB'
  if (p.count !== Math.floor(size / p.chunkSize)) return 'count is not floor(size / chunk)'
  if (p.count > 1000) return 'over 1000 chunks'
  let at = 0
  for (const [i, r] of p.ranges.entries()) {
    if (r.start !== at) return `gap before part ${i + 1}`
    const len = r.end - r.start + 1
    const last = i === p.ranges.length - 1
    if (!last && len !== p.chunkSize) return `part ${i + 1} is not chunk size`
    if (last && (len < p.chunkSize || len > 128 * MB)) return 'last part out of range'
    at = r.end + 1
  }
  return at === size ? null : 'bytes left over'
}

for (const size of [300_000, 4.8 * MB, 5 * MB, 63 * MB, 64 * MB, 64 * MB + 1, 100 * MB, 150 * MB, 191 * MB + 12345, 256 * MB, 512 * MB]) {
  const s = Math.round(size)
  const why = valid(s)
  check(`${(s / MB).toFixed(1)} MB is split the way TikTok takes it`, why === null, why || '')
}
const svc = readFileSync(join(process.cwd(), 'services/tiktok.ts'), 'utf8')
check('the upload uses the plan, never one chunk of any size', /chunk_size: plan\.chunkSize,\s*\n\s*total_chunk_count: plan\.count,/.test(svc) && !/chunk_size: videoSize/.test(svc))
check('each part is sent with its own range, and a part TikTok refuses is named', /'Content-Range': `bytes \$\{start\}-\$\{end\}\/\$\{videoSize\}`/.test(svc) && /failed on part \$\{i \+ 1\} of \$\{plan\.count\}/.test(svc))

if (failed) { console.error(`\n${failed} TikTok chunk check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
