// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// IS THE AMAZON UPLOAD MOVING (Seb, 2026-10-12: "once youtube is done, MVP
// automatically uploads to amazon but it takes a while.. could we have a
// running progress bar somewhere to know it's not stuck").
//
// SCOUT already reports, per store, the step it is on and the real share of
// the file sent (MVP_STOREFRONT_STATUS); from 1.46.1 also which video of how
// many. Bulk Amazon upload only showed "Sending to Amazon…" for the whole run.
// This reads SCOUT's report into what the bar shows, and says "no word for a
// while" apart from "moving", because a bar that keeps sliding while nothing
// happens is the exact thing the creator was worried about.
// Imports nothing. Tested in scripts/test-amazon-progress.

export interface StoreProgressIn {
  step?: string; pct?: number | null; at?: number
  done?: number; total?: number; current?: number; title?: string
  /** SCOUT 1.46.2: which try at this video, of how many, and why the last
   *  try stopped, so a restart from 0% is never silent. */
  attempt?: number; attempts?: number; lastError?: string | null
}

export interface StoreRow {
  domain: string
  step: string
  /** Real percentage of this video's file sent, or null when the step has no size. */
  pct: number | null
  done: number | null
  total: number | null
  current: number | null
  title: string | null
  at: number
  finished: boolean
  /** The try at this video (2 of 3 and so on), when SCOUT says. */
  attempt: number | null
  attempts: number | null
  /** Why the last try stopped, in SCOUT's words; null on a first try. */
  lastError: string | null
}

export interface AmazonProgressView {
  rows: StoreRow[]
  /** Videos finished and given, across the stores, when SCOUT said both. */
  done: number | null
  total: number | null
  /** 0 to 100 across the whole run when it can be worked out, else null. */
  overallPct: number | null
  /** Seconds since SCOUT last said anything. */
  quietFor: number | null
  /** Running, and nothing from SCOUT for STALL_SECONDS. */
  quiet: boolean
}

export const STALL_SECONDS = 180
const FINAL = /^(Published|Already there|Failed)$/i

/**
 * @param since  When this page's run started (ms). Older reports are a
 *               previous run's and are left out. Null: show what SCOUT is
 *               doing now from anywhere (the background tab), fresh reports only.
 */
export function readAmazonProgress(
  progress: Record<string, StoreProgressIn> | null | undefined,
  opts: { since: number | null; now: number; running: boolean },
): AmazonProgressView {
  const FRESH_MS = 120_000
  const rows: StoreRow[] = []
  for (const [domain, p] of Object.entries(progress || {})) {
    if (!p || typeof p.at !== 'number') continue
    if (opts.since != null ? p.at < opts.since - 5_000 : opts.now - p.at > FRESH_MS) continue
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const total = num(p.total), done = num(p.done)
    const step = String(p.step || 'Working')
    const finished = total != null && done != null ? done >= total : FINAL.test(step)
    rows.push({
      domain, step,
      pct: typeof p.pct === 'number' ? Math.max(0, Math.min(100, Math.round(p.pct))) : null,
      done, total, current: num(p.current), title: p.title ? String(p.title) : null,
      at: p.at, finished,
      attempt: num(p.attempt), attempts: num(p.attempts),
      lastError: num(p.attempt) != null && (num(p.attempt) as number) > 1 && p.lastError ? String(p.lastError) : null,
    })
  }
  rows.sort((a, b) => Number(a.finished) - Number(b.finished) || a.domain.localeCompare(b.domain))
  // Not running from this page and every store finished: nothing to show.
  if (opts.since == null && rows.every((r) => r.finished)) return { rows: [], done: null, total: null, overallPct: null, quietFor: null, quiet: false }

  const counted = rows.length > 0 && rows.every((r) => r.total != null && r.done != null)
  const total = counted ? rows.reduce((n, r) => n + (r.total ?? 0), 0) : null
  const done = counted ? rows.reduce((n, r) => n + Math.min(r.done ?? 0, r.total ?? 0), 0) : null
  // The video being sent counts by how much of it has gone.
  const partial = counted ? rows.reduce((n, r) => n + (!r.finished && r.pct != null && r.pct < 100 ? r.pct / 100 : 0), 0) : 0
  const overallPct = counted && total ? Math.min(100, Math.round(((done ?? 0) + partial) / total * 100)) : null
  const latest = rows.length ? Math.max(...rows.map((r) => r.at)) : null
  const quietFor = latest != null ? Math.max(0, Math.round((opts.now - latest) / 1000)) : null
  return {
    rows, done, total, overallPct, quietFor,
    quiet: opts.running && rows.some((r) => !r.finished) && quietFor != null && quietFor >= STALL_SECONDS,
  }
}

/** "4:05" for seconds. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
