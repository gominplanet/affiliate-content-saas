// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE'S TOP 100, DAY BY DAY (Seb, 2026-10-17, screenshots of TrybeDaily's
// Top brands: movers this week, days in, #1 days, streaks, the last 30 days).
// All of that needs the Top 100 of every day, and MVP kept only the latest
// read. So each admin read of the Top 100 is also kept as that day's row in
// the meta table (key top:YYYY-MM-DD, TOP_DAYS_KEEP days), brand by brand: its
// videos in it, its best place and its videos in the top 10. A later read on
// the same day replaces the earlier one. A day with no read has no row, so a
// gap reads as "not saved", never as "out of the Top 100".
// Pure, so it is tested (scripts/test-trybe-topdays.ts).

export const TOP_DAYS_KEEP = 60

export const topDayKey = (iso: string) => `top:${iso.slice(0, 10)}`

/** One brand on one day: videos in the Top 100, best place, videos in the top 10. */
export interface TopDayBrand { v: number; b: number | null; t10: number }

export interface TopDay { at: string; entries: number; brands: Record<string, TopDayBrand> }

/** That day's row from one read. A video whose brand has no id is placed by
 *  its name (`nameIds`, lower case), and left out when MVP cannot place it. */
export function topDayOf(
  entries: Array<{ rank: number | null; brandId: string | null; brandName: string | null }>,
  nameIds: Map<string, string>,
  at: string,
): TopDay {
  const brands: Record<string, TopDayBrand> = {}
  for (const e of entries) {
    const id = e.brandId || (e.brandName ? nameIds.get(e.brandName.toLowerCase()) : undefined)
    if (!id) continue
    const cur = brands[id] ?? { v: 0, b: null, t10: 0 }
    cur.v++
    if (e.rank != null && (cur.b == null || e.rank < cur.b)) cur.b = e.rank
    if (e.rank != null && e.rank <= 10) cur.t10++
    brands[id] = cur
  }
  return { at, entries: entries.length, brands }
}
