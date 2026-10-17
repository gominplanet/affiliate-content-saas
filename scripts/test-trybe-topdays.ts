// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE's Top 100, day by day (Seb, 2026-10-17, after TrybeDaily's Top
// brands): every admin read of the Top 100 is also kept as that day's row.

import { readFileSync } from 'node:fs'
import { topDayKey, topDayOf, TOP_DAYS_KEEP } from '../lib/trybe-topdays'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

// 1. The day's row
check('a day is keyed by its date', topDayKey('2026-10-17T23:59:00.000Z') === 'top:2026-10-17')
check('the day key never matches the Top 100 or hooks keys', !topDayKey('2026-10-17').startsWith('top100'))
const day = topDayOf([
  { rank: 1, brandId: 'a', brandName: 'Alpha' },
  { rank: 7, brandId: 'a', brandName: 'Alpha' },
  { rank: 40, brandId: 'a', brandName: 'Alpha' },
  { rank: 12, brandId: null, brandName: 'Beta Co' },
  { rank: null, brandId: 'c', brandName: 'Gamma' },
  { rank: 3, brandId: null, brandName: 'Unknown Brand' },
], new Map([['beta co', 'b']]), '2026-10-17T10:00:00.000Z')
check('videos, best place and top 10 are counted per brand', day.brands.a?.v === 3 && day.brands.a?.b === 1 && day.brands.a?.t10 === 2)
check('a video without a brand id is placed by its brand name', day.brands.b?.v === 1 && day.brands.b?.b === 12 && day.brands.b?.t10 === 0)
check('a video with no place counts as a video, with no best place', day.brands.c?.v === 1 && day.brands.c?.b === null)
check('a brand MVP cannot place is left out, not guessed', Object.keys(day.brands).length === 3)
check('the row says how many videos the read had and when', day.entries === 6 && day.at === '2026-10-17T10:00:00.000Z')
check('two months are kept', TOP_DAYS_KEEP >= 45)

// 2. The admin read keeps it
const route = read('app/api/labs/trybe/route.ts')
const top = route.slice(route.indexOf("if (action === 'top100') {"), route.indexOf("if (action === 'top100_hooks') {"))
check('the Top 100 read saves the day row', /upsert\(\{ key: topDayKey\(now\), value: topDayOf\(entries, nameIds, now\)/.test(top))
check('old day rows are cleared after TOP_DAYS_KEEP days', /delete\(\)\.like\('key', 'top:%'\)\.lt\('key', topDayKey\(new Date\(Date\.now\(\) - TOP_DAYS_KEEP \* 86_400_000\)/.test(top))
check('a failed day row never fails the read', /try \{\s*await admin\.from\('trybe_directory_meta'\)\.upsert\(\{ key: topDayKey/.test(top))
check('only an admin read reaches the day row', top.indexOf("if (tier !== 'admin')") > -1 && top.indexOf("if (tier !== 'admin')") < top.indexOf('topDayKey(now)'))
check('a read that matched nothing saves no day', top.indexOf('matched: 0, sample })\n    }') > -1 && top.indexOf('matched: 0, sample })\n    }') < top.indexOf('topDayKey(now)'))

if (failures.length) {
  console.error('❌ trybe top days guard failed:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log('✓ trybe top days guard passed')
