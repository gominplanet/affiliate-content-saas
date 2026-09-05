// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Does the video library analysis tell the truth?
//
// Every wrong number this page has shown a creator was arithmetic nobody could
// run: it needed a browser, an extension and a live Amazon session, so it was
// only ever checked by shipping it and looking. "Every video is 0s long" and
// "6,700 videos have no product attached" both reached a real creator that way.
//
// The analysis is now a pure function, so it is checked here instead, against
// fixtures shaped like a real library: thousands of videos, metrics missing on
// some, a duration Amazon never sends, and a scattering of genuine zeros that
// must stay distinguishable from absent data.
import { analyseVideoLibrary, videoLengthSec, type VideoRow, type EarningRow } from '../lib/video-insights'

const failures: string[] = []
const check = (name: string, cond: boolean | undefined, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── a library shaped like the real one ──────────────────────────────────────
// 6,771 videos, no duration on any of them (Amazon does not send one), views and
// hearts on all, a block of genuine zero-view uploads, and one month of high
// performers so the trends have something to find.
const rows: VideoRow[] = []
const months = ['2023-04', '2023-08', '2024-05', '2025-06', '2025-10', '2026-06']
for (let i = 0; i < 6771; i++) {
  // Hits are picked on i alone and then assigned a month. Deriving them from the
  // month index as well looked reasonable and produced none at all: i % 6 === 3
  // and i % 40 === 0 have no common solutions, so the fixture silently contained
  // no hits and the test was checking nothing.
  const isHit = i % 137 === 0
  const m = isHit ? '2025-06' : months[i % months.length]
  const isDead = !isHit && i % 16 === 0       // ~420 videos with a real zero
  rows.push({
    aci: `aci-${i}`,
    description: `video ${i}`,
    state: i % 150 === 0 ? 'DRAFT' : 'PUBLISHED',
    views: isDead ? 0 : (isHit ? 15000 : 40 + (i % 120)),
    // Hits vary wildly in hearts, as they do in the real library: one video with
    // 29,352 views drew 2 hearts while another with 19,848 drew 606. A fixture
    // where every hit has the same hearts cannot tell the two apart, which is
    // the whole point of ranking by resonance.
    hearts: isDead ? 0 : (isHit ? (i % 2 === 0 ? 2 : 400) : i % 7),
    avg_pct_viewed: 20 + (i % 70),
    avg_view_sec: 12 + (i % 30),
    duration_sec: null,                        // Amazon sends no length
    product_count: null,                       // nor a product count
    published_at: `${m}-15T00:00:00Z`,
  })
}
const earn: EarningRow[] = [
  { period_start: '2026-06-01', earnings_cents: 1411000, store_scope: 'onsite' },
  { period_start: '2026-06-01', earnings_cents: 7000, store_scope: 'offsite' },
  { period_start: '2026-07-01', earnings_cents: 900000, store_scope: 'onsite' },
]

const r = analyseVideoLibrary(rows, earn)

// ── videos nobody watched must not shape quality findings ───────────────────
// A video with no views still reports a percent watched, and it means nothing.
// 429 of them sat in the top retention band on the real page, making it look
// like holding attention destroys reach. They belong in dead weight and nowhere
// else.
const bandTotal = r.retentionVsReach.reduce((a, b) => a + b.videos, 0)
check('unwatched videos are kept out of the retention bands',
  bandTotal === rows.filter(x => (x.views ?? 0) > 0 && x.avg_pct_viewed != null).length,
  `${bandTotal} banded, ${r.deadWeight.noViews} unwatched in the library`)
check('but they are still counted as dead weight', r.deadWeight.noViews > 400,
  `${r.deadWeight.noViews}`)
check('no retention band is built from videos with no views',
  r.retentionVsReach.every(b => (b.medianViews ?? 1) > 0),
  'a band whose median reach is zero is a band of videos nobody saw')

// ── the length table must not report the circular percentage ────────────────
// Length here is watch-seconds divided by percent watched, so reporting percent
// watched per length band is the algebra restating itself. It produced a
// perfectly descending 71, 61, 54, 48, 40 that read as a finding and was not.
check('the length table carries no percent-watched column',
  r.byLength.every(b => !('avgPctViewed' in b)),
  'percent watched cannot be compared across bands derived from it')
check('the length table carries reach, which is measured independently',
  r.byLength.every(b => 'medianViews' in b))

// ── the period every number covers ──────────────────────────────────────────
check('the library window is reported', !!r.window.libraryFrom && !!r.window.libraryTo,
  JSON.stringify(r.window))
check('the earnings window is reported separately from it',
  r.window.earningsFrom === '2026-06' && r.window.earningsMonths === 2,
  JSON.stringify(r.window))

// ── MVP has to say something, not just draw it ──────────────────────────────
check('findings are produced', r.findings.length >= 2, `${r.findings.length} findings`)
check('every finding carries evidence and an action',
  r.findings.every(f => f.headline && f.detail && f.action))
// Dead uploads spread evenly across the library are not a month that went
// wrong, and must not be reported as one.
check('evenly spread dead uploads are not blamed on a month',
  r.findings.some(f => f.kind === 'dead' && /spread across the library/.test(f.detail)),
  r.findings.filter(f => f.kind === 'dead').map(f => f.detail).join(' | '))

// But a month where almost nothing was ever seen IS a cause worth naming.
{
  const broken: VideoRow[] = []
  for (let i = 0; i < 600; i++) {
    const bad = i % 3 === 0
    broken.push({
      aci: `b-${i}`, description: `v${i}`, state: 'PUBLISHED',
      views: bad ? 0 : 200, hearts: bad ? 0 : 5,
      avg_pct_viewed: 45, avg_view_sec: 20, duration_sec: null,
      product_count: null,
      published_at: bad ? '2026-04-10T00:00:00Z' : `2025-0${(i % 8) + 1}-10T00:00:00Z`,
    })
  }
  const br = analyseVideoLibrary(broken, [])
  const dead = br.findings.find(f => f.kind === 'dead')
  check('a month where nothing was seen is named as a cause',
    !!dead && /2026-04/.test(dead.detail),
    dead ? dead.detail : 'no dead-weight finding at all')
  check('and the action points at that month rather than at the videos',
    !!dead && /2026-04/.test(dead.action), dead?.action)
}

// ── the length Amazon refuses to report ─────────────────────────────────────
// Amazon sends no duration on the video list, but it does send average seconds
// watched and average percent watched, and a length follows from those. The
// fixture carries both, so a length must be worked out for every video and
// marked as derived rather than reported.
const watched = rows.filter(x => (x.views ?? 0) > 0).length
check('a length is worked out for every video somebody watched',
  r.deadWeight.durationKnown === watched,
  `durationKnown=${r.deadWeight.durationKnown} of ${watched} watched`)
check('the worked-out lengths are marked as derived, not reported',
  r.deadWeight.durationDerived === r.deadWeight.durationKnown,
  `${r.deadWeight.durationDerived} derived of ${r.deadWeight.durationKnown}`)
check('length bands are populated from them', r.byLength.length >= 2,
  `${r.byLength.length} bands`)

// The arithmetic itself: 19 seconds watched at 40% is a video of about 48s.
const d = videoLengthSec({ duration_sec: null, avg_view_sec: 19, avg_pct_viewed: 40 })
check('watch time and percentage give the length', !!d && Math.abs(d.sec - 47.5) < 0.01, `${d?.sec}`)
check('a reported length wins over the derivation',
  videoLengthSec({ duration_sec: 30, avg_view_sec: 19, avg_pct_viewed: 40 })?.derived === false)
// Below a few percent watched the division turns Amazon's rounding into
// nonsense, so those stay unknown rather than being estimated badly.
check('a barely watched video is left unknown, not estimated',
  videoLengthSec({ duration_sec: null, avg_view_sec: 2, avg_pct_viewed: 1 }) === null)
check('an implausible result is discarded',
  videoLengthSec({ duration_sec: null, avg_view_sec: 3600, avg_pct_viewed: 5 }) === null,
  'twenty hours is not a shoppable video')
check('no length at all stays no length',
  videoLengthSec({ duration_sec: null, avg_view_sec: null, avg_pct_viewed: 40 }) === null)
check('product counts are not claimed', r.deadWeight.productCountKnown === 0,
  `productCountKnown=${r.deadWeight.productCountKnown}`)
check('a real zero view count is still counted', r.deadWeight.noViews > 400,
  `noViews=${r.deadWeight.noViews}`)

// ── the new analyses ────────────────────────────────────────────────────────
check('every publish month with enough videos appears', r.viewsByMonth.length === months.length,
  `${r.viewsByMonth.length} months, expected ${months.length}`)
const june = r.viewsByMonth.find(m => m.month === '2025-06')
check('the month with the hits shows them in its top decile',
  !!june && june.topDecileViews != null && june.medianViews != null && june.topDecileViews > june.medianViews,
  june ? `median=${june.medianViews} p90=${june.topDecileViews}` : 'month missing')

check('retention bands are populated', r.retentionVsReach.length >= 3,
  `${r.retentionVsReach.length} bands`)
check('retention bands account for every WATCHED video with both figures',
  r.retentionVsReach.reduce((a, b) => a + b.videos, 0)
    === rows.filter(x => x.avg_pct_viewed != null && (x.views ?? 0) > 0).length)

check('resonance has a view floor', r.resonance.floor >= 500, `floor=${r.resonance.floor}`)
check('resonance ranks the loved above the ignored',
  r.resonance.loved.length > 0 && r.resonance.ignored.length > 0 &&
  r.resonance.loved[0].heartsPerThousand > r.resonance.ignored[0].heartsPerThousand)
check('no video under the floor is ranked',
  r.resonance.loved.every(v => v.views >= r.resonance.floor))

const zeroTotal = r.zeroViewsByMonth.reduce((a, b) => a + b.zero, 0)
check('the zero-view videos are all placed in time', zeroTotal === r.deadWeight.noViews,
  `${zeroTotal} placed vs ${r.deadWeight.noViews} counted`)

check('states are counted and total the library',
  r.states.reduce((a, b) => a + b.videos, 0) === rows.length)

check('onsite and offsite are split', r.concentration.onsiteCents === 2311000 && r.concentration.offsiteCents === 7000,
  `onsite=${r.concentration.onsiteCents} offsite=${r.concentration.offsiteCents}`)

// ── absence must never read as zero ─────────────────────────────────────────
const blank = analyseVideoLibrary(
  rows.map(x => ({ ...x, views: null, hearts: null, avg_pct_viewed: null })),
  [],
)
check('unreported views give a null total, not zero', blank.totals.views === null,
  `got ${blank.totals.views}`)
check('unreported views give a null median', blank.totals.medianViews === null)
check('unreported retention gives a null average', blank.totals.avgPctViewed === null)
check('with no watch time reported, no length is worked out', blank.deadWeight.durationKnown === 0,
  `${blank.deadWeight.durationKnown}`)
check('no earnings gives a null split, not zero',
  blank.concentration.onsiteCents === null && blank.concentration.offsiteCents === null,
  `onsite=${blank.concentration.onsiteCents} offsite=${blank.concentration.offsiteCents}`)
check('nothing is ranked for resonance when no hearts were reported',
  blank.resonance.loved.length === 0)
check('a library with no reported views reports no dead weight from views',
  blank.deadWeight.noViews === 0)

// ── a small library must not produce confident trends ───────────────────────
const tiny = analyseVideoLibrary(rows.slice(0, 4), [])
check('a month with under five videos is not charted', tiny.viewsByMonth.length === 0,
  `${tiny.viewsByMonth.length} months from 4 videos`)

console.log(`${failures.length ? 'FAIL' : 'ALL PASS'}  (${rows.length.toLocaleString()} videos analysed)`)
for (const f of failures) console.log(`  ${f}`)
process.exit(failures.length ? 1 : 0)
