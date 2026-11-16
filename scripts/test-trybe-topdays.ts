// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE's Top 100, day by day (Seb, 2026-10-17, after TrybeDaily's Top
// brands): every admin read of the Top 100 is also kept as that day's row.

import { readFileSync } from 'node:fs'
import { topDayKey, topDayOf, TOP_DAYS_KEEP, DAY_VIDEOS_KEEP } from '../lib/trybe-topdays'
import { readTopCreatives } from '../lib/trybe-pick'

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

// 1b. Each video too (Seb, 2026-11-16: "start saving each video that are in it daily")
const withIds = topDayOf([
  { rank: 4, brandId: 'a', brandName: 'Alpha', submissionId: 'v2' },
  { rank: 2, brandId: 'a', brandName: 'Alpha', submissionId: 'v1' },
  { rank: 9, brandId: 'a', brandName: 'Alpha', submissionId: 'v1' },
  { rank: 30, brandId: null, brandName: 'Beta Co', submissionId: 'v3' },
  { rank: 50, brandId: 'c', brandName: 'Gamma', submissionId: null },
], new Map([['beta co', 'b']]), '2026-11-17T10:00:00.000Z')
check('each video is kept by its id with its place, best first', JSON.stringify(withIds.brands.a?.s) === JSON.stringify([['v1', 2], ['v2', 4]]))
check('the same video twice keeps its better place, and counts as a video each time', withIds.brands.a?.v === 3 && withIds.brands.a?.s?.length === 2)
check('a video placed by its brand name is kept too', JSON.stringify(withIds.brands.b?.s) === JSON.stringify([['v3', 30]]))
check('a video with no id is counted, not kept', withIds.brands.c?.v === 1 && withIds.brands.c?.s === undefined)
check('the day says how many videos carried an id', withIds.vids === 4)
check('a day with no ids says nothing, so its videos read as not saved', day.vids === undefined)
check('a brand keeps at most DAY_VIDEOS_KEEP videos a day', topDayOf(Array.from({ length: 40 }, (_, i) => ({ rank: i + 1, brandId: 'a', brandName: 'A', submissionId: `v${i}` })), new Map(), 'x').brands.a.s!.length === DAY_VIDEOS_KEEP)
const read2 = readTopCreatives({ data: [{ rank: 3, submissionId: 's9', brandId: 'b-aaaaaa1' }, { rank: 5, submission: { id: 's10' }, brand: { id: 'b-aaaaaa1' } }, { rank: 7, brandName: 'X' }] })
check('TRYBE\u2019s Top 100 is read with each video\u2019s id', read2[0].submissionId === 's9' && read2[1].submissionId === 's10' && read2[2].submissionId === null)

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
