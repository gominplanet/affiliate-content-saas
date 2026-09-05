// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What a creator's Amazon video library says about their business.
//
// This is deliberately a pure function over rows, with no database and no
// request in it. Every wrong number this page has shown a creator (every video
// 0s long, 6,700 videos with no product, a completed crawl reported as
// unfinished) was arithmetic that could not be run without a browser, a Chrome
// extension and a live Amazon session. Now it can be run against fixtures, and
// scripts/test-video-insights.mjs does exactly that.
//
// The rules it enforces:
//   A metric Amazon did not report is null, never zero.
//   Every average and count says how many videos it was taken over.
//   A comparison between two figures on different time bases is not made.

export interface VideoRow {
  aci: string
  description: string | null
  state: string | null
  views: number | null
  hearts: number | null
  avg_pct_viewed: number | null
  avg_view_sec: number | null
  duration_sec: number | null
  product_count: number | null
  published_at: string | null
}

export interface EarningRow {
  period_start: string
  earnings_cents: number | null
  store_scope: string | null
}

/** A video's length in seconds, reported where Amazon reports one and worked out
 *  where it does not.
 *
 *  Amazon's video list carries no duration, which left the single most useful
 *  question on the page ("how long should the next one be") permanently blank.
 *  But it does report, for every video, the average seconds watched and the
 *  average percentage watched, and a length follows from those two: watch 19
 *  seconds and that is 40% of it, the video is about 48 seconds long.
 *
 *  This is a derivation, not a measurement, and it is labelled as one everywhere
 *  it surfaces. Two guards keep it honest. Below about 5% watched the division
 *  amplifies Amazon's rounding into nonsense, so those are left unknown rather
 *  than estimated badly. And a result outside a plausible range for a shoppable
 *  video is discarded, because a wrong length lands in a band and skews the
 *  advice, which is worse than an empty panel that explains itself. */
export function videoLengthSec(r: { duration_sec: number | null; avg_view_sec: number | null; avg_pct_viewed: number | null }): { sec: number; derived: boolean } | null {
  if (r.duration_sec != null && r.duration_sec > 0) return { sec: r.duration_sec, derived: false }
  const watched = r.avg_view_sec
  const pct = r.avg_pct_viewed
  if (watched == null || pct == null) return null
  if (!(watched > 0) || !(pct >= 5) || !(pct <= 100)) return null
  const sec = watched / (pct / 100)
  if (!Number.isFinite(sec) || sec < 1 || sec > 14400) return null
  return { sec, derived: true }
}

/** Length bands a creator actually thinks in, rather than even splits. */
const BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Under 20s', min: 0, max: 20 },
  { label: '20 to 45s', min: 20, max: 45 },
  { label: '45 to 90s', min: 45, max: 90 },
  { label: '90s to 3 min', min: 90, max: 180 },
  { label: 'Over 3 min', min: 180, max: Number.POSITIVE_INFINITY },
]

/** Mean over the values that exist. Returns null when none did, so "Amazon did
 *  not report this" never renders as a zero average. */
function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}
function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
/** The value at a given position once sorted. Used for the top decile, which
 *  says whether a month had a hit in it rather than only how the typical video
 *  did, and those are different questions. */
function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** How much of a video was watched, in bands a person thinks in. Retention is
 *  the one quality signal Amazon reports on every video, so it is worth asking
 *  whether it buys anything. */
const RETENTION_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Under 20% watched', min: 0, max: 20 },
  { label: '20 to 40%', min: 20, max: 40 },
  { label: '40 to 60%', min: 40, max: 60 },
  { label: '60 to 80%', min: 60, max: 80 },
  { label: 'Over 80%', min: 80, max: Number.POSITIVE_INFINITY },
]

// Percent viewed arrives on a 0 to 100 scale, which the page confirms: the
// library averages 48 and individual videos read 33, 57, 40. No rescaling here.
// A helper that "handled" a 0 to 1 scale as well would turn a genuine 1% video
// into a 100% one, which is the sort of guess this file exists to avoid.

export function analyseVideoLibrary(rows: VideoRow[], earn: EarningRow[]) {
  const withViews = rows.filter(r => r.views != null) as (VideoRow & { views: number })[]
  const withRetention = rows.filter(r => r.avg_pct_viewed != null)

  // ── retention by length ───────────────────────────────────────────────────
  // The most directly actionable thing here: how long a video should be.
  // A duration of zero is Amazon not reporting one, not a zero-length video.
  // Treating it as real put all 6,763 videos in the shortest band and produced a
  // confident answer to "how long should the next one be" from no data at all.
  // A length for every video that has one, reported or worked out from watch
  // time. Amazon reports no duration at all on the video list, so without the
  // derivation this section stays empty forever on a library of thousands.
  const lengths = new Map<string, { sec: number; derived: boolean }>()
  for (const r of rows) {
    const l = videoLengthSec(r)
    if (l) lengths.set(r.aci, l)
  }
  const knownDuration = rows.filter(r => lengths.has(r.aci))
  const derivedCount = [...lengths.values()].filter(l => l.derived).length
  const byLength = BANDS.map(b => {
    const inBand = knownDuration.filter(r => {
      const s = (lengths.get(r.aci) as { sec: number }).sec
      return s >= b.min && s < b.max
    })
    const ret = inBand.map(r => r.avg_pct_viewed).filter((v): v is number => v != null)
    const vw = inBand.map(r => r.views).filter((v): v is number => v != null)
    return {
      label: b.label,
      videos: inBand.length,
      avgPctViewed: mean(ret),
      medianViews: median(vw),
      totalViews: vw.length ? vw.reduce((a, c) => a + c, 0) : null,
    }
  }).filter(b => b.videos > 0)

  // ── dead weight ───────────────────────────────────────────────────────────
  // Uploads that earned nothing back. Counting them is the point: on a library
  // of thousands this is usually a number the creator has never seen.
  const noViews = withViews.filter(r => r.views === 0).length
  // Only counted where Amazon actually reported a product count. It returns zero
  // for nearly every video unless metrics are requested, and reporting that as
  // "6,700 videos have no product attached" states as fact something we do not
  // know and the creator knows to be false.
  //
  // A stored zero is not a null, so filtering on null alone still counted 6,700
  // videos as having no product. The honest test is proportion: if almost none of
  // the library has a product count above zero, the field was not reported, and
  // no amount of type-checking makes that data real.
  const positiveCounts = rows.filter(r => (r.product_count ?? 0) > 0).length
  const productCountTrusted = positiveCounts >= Math.max(10, rows.length * 0.1)
  const withProductCount = productCountTrusted ? rows.filter(r => r.product_count != null) : []
  const noProducts = withProductCount.filter(r => r.product_count === 0).length
  const notLive = rows.filter(r => r.state && !/live|publish/i.test(r.state)).length

  // ── output over time ──────────────────────────────────────────────────────
  // Videos published per month, so it can be set against earnings per month and
  // answer whether publishing more actually paid.
  const perMonth: Record<string, { videos: number; views: number | null }> = {}
  for (const r of rows) {
    if (!r.published_at) continue
    const m = r.published_at.slice(0, 7)
    if (!perMonth[m]) perMonth[m] = { videos: 0, views: null }
    perMonth[m].videos++
    if (r.views != null) perMonth[m].views = (perMonth[m].views ?? 0) + r.views
  }

  // Earnings for the same months, so the comparison is on one chart rather than
  // in the creator's head across two pages.
  const earnByMonth: Record<string, number> = {}
  // Where the money comes from, against where the audience is. A creator can
  // earn almost everything on Amazon's own surface while holding a library with
  // millions of views that has never been posted anywhere else, and that gap is
  // the largest single fact this page can show.
  let onsiteCents: number | null = null
  let offsiteCents: number | null = null
  for (const e of (earn ?? [])) {
    if (e.earnings_cents == null) continue
    const m = e.period_start.slice(0, 7)
    earnByMonth[m] = (earnByMonth[m] ?? 0) + e.earnings_cents
    if (e.store_scope === 'onsite') onsiteCents = (onsiteCents ?? 0) + e.earnings_cents
    else if (e.store_scope === 'offsite') offsiteCents = (offsiteCents ?? 0) + e.earnings_cents
  }

  const months = Array.from(new Set([...Object.keys(perMonth), ...Object.keys(earnByMonth)]))
    .sort()
    .slice(-18)
    .map(m => ({
      month: m,
      videos: perMonth[m]?.videos ?? 0,
      views: perMonth[m]?.views ?? null,
      earningsCents: earnByMonth[m] ?? null,
    }))

  const top = (pick: (r: VideoRow) => number | null, n = 8) =>
    rows
      .filter(r => pick(r) != null)
      .sort((a, b) => (pick(b) as number) - (pick(a) as number))
      .slice(0, n)
      .map(r => ({
        aci: r.aci,
        description: r.description,
        views: r.views,
        hearts: r.hearts,
        avgPctViewed: r.avg_pct_viewed,
        // The same length the bands use: reported where Amazon reports one,
        // worked out from watch time where it does not. Rounded, because a
        // derived figure quoted to the second would claim a precision it has not
        // got.
        durationSec: (() => { const l = lengths.get(r.aci); return l ? Math.round(l.sec) : null })(),
        durationDerived: (lengths.get(r.aci)?.derived ?? null),
        productCount: r.product_count,
        publishedAt: r.published_at,
      }))

  // ── is Amazon still showing your videos to people ────────────────────────
  // Median views per video by the month it was published. This is a different
  // question from "did I publish more", and on a library of thousands it is the
  // more important one: it says whether Amazon's distribution to this creator is
  // improving or decaying, per video, independent of how many they shot.
  //
  // Older videos have had longer to accumulate views, so the earliest months are
  // flattered. That bias is real and is stated on the chart rather than being
  // corrected away with an assumption about how views accrue, which we have no
  // data to support: Amazon reports one lifetime figure, not a curve.
  const viewsByMonth: { month: string; videos: number; medianViews: number | null; topDecileViews: number | null }[] = []
  {
    const buckets: Record<string, number[]> = {}
    for (const r of rows) {
      if (!r.published_at || r.views == null) continue
      const m = r.published_at.slice(0, 7)
      ;(buckets[m] ??= []).push(r.views)
    }
    for (const m of Object.keys(buckets).sort()) {
      const v = buckets[m]
      // Under five videos a median is noise, and a noisy line invites exactly
      // the over-reading this chart is meant to prevent.
      if (v.length < 5) continue
      viewsByMonth.push({ month: m, videos: v.length, medianViews: median(v), topDecileViews: quantile(v, 0.9) })
    }
  }

  // ── does holding attention buy reach ─────────────────────────────────────
  // Retention is the only quality signal Amazon reports on every video, and
  // nobody has told this creator whether it does anything for them. Both figures
  // are per video and both are lifetime, so unlike views against monthly
  // earnings this comparison is on a level footing.
  const retentionVsReach = RETENTION_BANDS.map(b => {
    const inBand = rows.filter(r => {
      const p = r.avg_pct_viewed
      return p != null && r.views != null && p >= b.min && p < b.max
    })
    return {
      label: b.label,
      videos: inBand.length,
      medianViews: median(inBand.map(r => r.views as number)),
      medianHearts: median(inBand.map(r => r.hearts).filter((v): v is number => v != null)),
    }
  }).filter(b => b.videos > 0)

  // ── what people actually loved ───────────────────────────────────────────
  // Hearts per thousand views separates the videos an audience cared about from
  // the ones Amazon simply pushed. A ranking by views alone cannot tell those
  // apart, and they lead to different decisions about what to make next.
  //
  // A floor on views is essential: without it a video with 3 views and 1 heart
  // tops the list forever.
  const resonanceFloor = Math.max(500, Math.round(median(withViews.map(r => r.views)) ?? 0))
  const scored = rows
    .filter(r => r.views != null && r.views >= resonanceFloor && r.hearts != null)
    .map(r => ({
      aci: r.aci,
      description: r.description,
      views: r.views as number,
      hearts: r.hearts as number,
      avgPctViewed: r.avg_pct_viewed,
      publishedAt: r.published_at,
      heartsPerThousand: (r.hearts as number) / ((r.views as number) / 1000),
    }))
  const resonance = {
    floor: resonanceFloor,
    scored: scored.length,
    median: median(scored.map(s => s.heartsPerThousand)),
    // Punched above their weight, and the reverse: big reach that left no mark.
    loved: [...scored].sort((a, b) => b.heartsPerThousand - a.heartsPerThousand).slice(0, 8),
    ignored: [...scored].sort((a, b) => a.heartsPerThousand - b.heartsPerThousand).slice(0, 5),
  }

  // ── when the dead uploads happened ───────────────────────────────────────
  // 429 videos with no views is trivia as a number. Placed in time it can show a
  // period where something went wrong, which is a fixable cause rather than 429
  // individually weak videos.
  const zeroViewsByMonth: { month: string; zero: number; videos: number }[] = []
  {
    const buckets: Record<string, { zero: number; videos: number }> = {}
    for (const r of rows) {
      if (!r.published_at || r.views == null) continue
      const m = r.published_at.slice(0, 7)
      const b = (buckets[m] ??= { zero: 0, videos: 0 })
      b.videos++
      if (r.views === 0) b.zero++
    }
    for (const m of Object.keys(buckets).sort()) zeroViewsByMonth.push({ month: m, ...buckets[m] })
  }

  // ── what state the library is in ─────────────────────────────────────────
  // "43 not live" does not say whether they are drafts worth finishing or
  // rejections worth forgetting, and those need different action.
  const states: { state: string; videos: number }[] = []
  {
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.state || 'not reported'] = (counts[r.state || 'not reported'] ?? 0) + 1
    for (const s of Object.keys(counts).sort((a, b) => counts[b] - counts[a])) states.push({ state: s, videos: counts[s] })
  }

  const allViews = withViews.map(r => r.views)
  return {
    ok: true as const,
    videos: rows.length,
    totals: {
      views: allViews.length ? allViews.reduce((a, c) => a + c, 0) : null,
      hearts: (() => {
        const h = rows.map(r => r.hearts).filter((v): v is number => v != null)
        return h.length ? h.reduce((a, c) => a + c, 0) : null
      })(),
      medianViews: median(allViews),
      avgPctViewed: mean(withRetention.map(r => r.avg_pct_viewed as number)),
      reportedViews: withViews.length,
      reportedRetention: withRetention.length,
    },
    deadWeight: {
      noViews, noProducts, notLive,
      productCountKnown: withProductCount.length,
      durationKnown: knownDuration.length,
      /** Of those, how many are worked out from watch time rather than reported
       *  by Amazon, so the panel can say which it is showing. */
      durationDerived: derivedCount,
    },
    byLength,
    months,
    viewsByMonth,
    retentionVsReach,
    resonance,
    zeroViewsByMonth,
    states,
    concentration: { onsiteCents, offsiteCents, totalViews: allViews.length ? allViews.reduce((a, c) => a + c, 0) : null },
    topByViews: top(r => r.views),
    topByHearts: top(r => r.hearts),
  }
}
