// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ROOM AND PAY, IN ONE VERDICT (lib/trybe-finder roomPayOf; Seb, 2026-11-06,
// a TRYBE creator showing TrybeDaily's brand lookup: "this one right here is
// crowded but paying, so this might be one to look at"). MVP showed how
// crowded a brand is and what it pays in separate chips; this puts them
// together in plain words. Held on the traps: either side not known is no
// verdict (never a guess), a brand approving nothing lately is not "paying"
// whatever its fee, TRYBE's payout range is said as a floor, the verdict is
// for choosing only, and every place a brand is shown uses it.
import { readFileSync } from 'node:fs'
import { roomPayOf, payLevelOf, ROOM_PAY_WORDS, crowdOf } from '../lib/trybe-finder'
import { BROWSE_SORTS } from '../lib/trybe-outreach'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const crowded = crowdOf({ creators: null, recent30: 520 })
const filling = crowdOf({ creators: null, recent30: 180 })
const open = crowdOf({ creators: null, recent30: 30 })
check('the crowd reads it is built on are what the verdict expects', crowded.level === 'crowded' && filling.level === 'filling' && open.level === 'open', [crowded.level, filling.level, open.level])

// THE WORDS
const cp = roomPayOf({ crowd: crowded, perVideo: 45, spend: { dollars: 23_400, basis: 'recent' } })
check('many creators and a good fee is Crowded but paying', cp.words === 'Crowded but paying' && cp.key === 'crowded_paying' && cp.tone === 'fair', cp)
check('it says what to do and why', /stand out/.test(cp.advice || '') && /520 videos in 30 days/.test(cp.why) && /about \$45 a video/.test(cp.why) && /\$23,400 a month to creators lately/.test(cp.why), cp.why)
check('it is for choosing only, never a message to a brand', /never put it in a message to a brand/.test(cp.why))
const rp = roomPayOf({ crowd: open, perVideo: 60 })
check('few creators and a good fee is Room and paying, the best', rp.words === 'Room and paying' && rp.tone === 'strong', rp)
const cl = roomPayOf({ crowd: crowded, perVideo: 10 })
check('many creators and a small fee is Crowded, low pay', cl.words === 'Crowded, low pay' && cl.tone === 'weak', cl)
check('every pair has words without a dash', Object.values(ROOM_PAY_WORDS).length === 9 && Object.values(ROOM_PAY_WORDS).every(w => !/[–—]| - /.test(w)))

// THE ORDER: the best first, pay first among equals
const ranks = (['open_paying', 'filling_paying', 'crowded_paying', 'crowded_low'] as const).map(k => {
  const [c, p] = k.split('_') as ['open' | 'filling' | 'crowded', string]
  const crowd = c === 'open' ? open : c === 'filling' ? filling : crowded
  return roomPayOf({ crowd, perVideo: p === 'paying' ? 60 : 10 }).rank
})
check('Room and paying, then filling, then crowded, then crowded and low', ranks[0] > ranks[1] && ranks[1] > ranks[2] && ranks[2] > ranks[3], ranks)
check('Crowded but paying ranks above Room, low pay', cp.rank > roomPayOf({ crowd: open, perVideo: 10 }).rank)

// THE PAY SIDE
check('a $40 video is paying', payLevelOf({ perVideo: 40 }).level === 'paying')
check('a $25 video with a big month is paying', payLevelOf({ perVideo: 25, spend: { dollars: 4_000, basis: 'recent' } }).level === 'paying')
check('a $25 video with little else is fair pay', payLevelOf({ perVideo: 25 }).level === 'some')
check('a $15 video is low pay, whatever the volume', payLevelOf({ perVideo: 15, spend: { dollars: 20_000, basis: 'recent' } }).level === 'low')
const quiet = payLevelOf({ perVideo: 80, spend: { dollars: 0, basis: 'recent' } })
check('approving nothing lately is not paying, whatever the fee, and says so', quiet.level === 'low' && /No videos approved in the last 30 days/.test(quiet.why), quiet)
check('no fee known: the month decides', payLevelOf({ perVideo: null, spend: { dollars: 6_000, basis: 'lifetime' } }).level === 'paying' && payLevelOf({ perVideo: null, spend: { dollars: 300, basis: 'lifetime' } }).level === 'low')
const floor = payLevelOf({ perVideo: null, paidOut: 50_000, paidOutFloor: true })
check('no fee or month: all its payouts decide, and TRYBE’s range is said as a floor', floor.level === 'paying' && /at least \$50,000 paid out/.test(floor.why), floor)

// NOT KNOWN IS NOT A VERDICT
const noPay = roomPayOf({ crowd: crowded, perVideo: null })
check('no pay known: no verdict, and why', noPay.words === null && noPay.rank === 0 && noPay.crowd === 'crowded' && /knows no pay per video/.test(noPay.why), noPay)
const noCrowd = roomPayOf({ crowd: crowdOf({ creators: null }), perVideo: 60 })
check('no crowd known: no verdict', noCrowd.words === null && noCrowd.rank === 0 && noCrowd.pay === 'paying', noCrowd)
check('nothing known: no verdict, never a zero', roomPayOf({ crowd: null, perVideo: null }).words === null)

// WHERE IT SHOWS
const route = read('app/api/labs/trybe/route.ts')
check('the brand list carries it', /room_pay: roomPayBy\.get\(r\.brand_id\) \?\? null/.test(route) && /const roomPayBy = new Map\(rows\.map/.test(route))
check('a payout range is passed as a floor', /paidOut: st\?\.paidOut \?\? bucket, paidOutFloor: st\?\.paidOut == null && bucket != null,\n      \}\)\]\s*\n    \}\)\)\n    \/\/ Top 100/.test(route))
check('Room and pay is a sort, best first, ranked over the wide pool', (BROWSE_SORTS as readonly string[]).includes('roomPay') && /sort === 'roomPay' \? \(roomPayBy\.get\(b\.r\.brand_id\)\?\.rank \?\? 0\) - \(roomPayBy\.get\(a\.r\.brand_id\)\?\.rank \?\? 0\)/.test(route) && /sort === 'roomPay' \|\| sort === 'payouts'/.test(route))
const outreach = read('components/labs/TrybeOutreach.tsx')
check('the page offers the sort', /\{ id: 'roomPay', label: 'Room and pay'/.test(outreach))
check('Find brands cards show it', /<RoomPayChip roomPay=\{b\.room_pay\} crowd=\{b\.crowd\}/.test(outreach) && !/<CrowdChip /.test(outreach))
check('the brand peek and Best new show it', /<RoomPayChip roomPay=\{brand\.room_pay\}/.test(read('components/labs/TrybeBrandPeek.tsx')) && /<RoomPayChip roomPay=\{b\.room_pay\}/.test(read('components/labs/TrybeBestNew.tsx')))
check('Home Best bets shows it, with why on hover', /b\.room_pay\?\.words \? <Tag tone=\{b\.room_pay\.tone === 'strong' \? 'good'/.test(read('components/labs/TrybeHome.tsx')) && /title=\{b\.room_pay\.why\}/.test(read('components/labs/TrybeHome.tsx')))
const table = read('components/labs/TrybeBrandTable.tsx')
check('the table has a Room and pay column, sorted by the verdict', /label: 'Room and pay'/.test(table) && /case 'room': return b\.room_pay\?\.rank \? 10 \+ b\.room_pay\.rank/.test(table) && /<Dot c=\{b\.room_pay\.tone\}>\{b\.room_pay\.words\}<\/Dot>/.test(table))
check('the spreadsheet has it too', /'Room', 'Room and pay',/.test(table) && /b\.room_pay\?\.words \|\| ''/.test(table))
const chips = read('components/labs/TrybeFinderControls.tsx')
check('the chip falls back to the crowd alone when pay is not known', /if \(!roomPay\?\.words \|\| !roomPay\.tone\) return <CrowdChip crowd=\{crowd\} windowDays=\{windowDays\} \/>/.test(chips))
check('posts in the last 30 days are shown, as TrybeDaily counts them', /in the last 30 days` : ''\}/.test(chips))

if (fails.length) { console.error(`✗ ${fails.length} room and pay check(s) failed:\n  ${fails.join('\n  ')}`); process.exit(1) }
console.log('✓ Room and pay: one verdict from the crowd and the pay, never a guess, shown wherever a brand is')
