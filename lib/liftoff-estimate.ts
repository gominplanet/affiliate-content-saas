// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW LONG A LAUNCH TAKES, SAID BEFORE THE PRESS (Seb, 2026-10-08: "if it
// says four hours to upload, and then you have to keep Chrome open, at least
// you tell people. So that might be something that people do at night").
//
// SCOUT uploads from the creator's own Chrome, one video at a time: each
// file comes down from MVP, then goes up to YouTube Studio and to Amazon.
// So the time is mostly the creator's own upload speed, which MVP measures
// when the videos are added to the batch (the same line, the same direction)
// and otherwise assumes. It is an estimate and says what it rests on.

/** Assumed when nothing was measured: a typical home upload. */
export const DEFAULT_UP_MBPS = 20
/** Where the measured speed is kept, per browser. */
export const UP_SPEED_KEY = 'mvp.liftoff.upMbps'
/** Amazon's own daily limit on the US store. */
export const AMAZON_US_PER_DAY = 20

/** Minutes SCOUT spends on each video besides moving the file: filling in
 *  Studio's pages and saving, and Amazon's upload form. */
const STUDIO_FILL_MIN = 3
const STUDIO_FINISH_MIN = 2
const AMAZON_FORM_MIN = 2

export interface EstimateInput {
  /** Each video's size in bytes; unknown sizes are left out and counted. */
  bytes: Array<number | null>
  /** Measured upload speed, or null to assume DEFAULT_UP_MBPS. */
  upMbps: number | null
  /** YouTube through SCOUT in Studio (file sent from Chrome), through the API
   *  (MVP's servers send the file, SCOUT only finishes in Studio), or not at all. */
  youtube: 'studio' | 'api' | 'none'
  amazon: boolean
}

export interface Estimate {
  /** Low and high, in minutes. */
  minutes: [number, number]
  totalBytes: number
  unknownSizes: number
  upMbps: number
  measured: boolean
  /** Videos past Amazon's 20 a day, which go the next day. */
  amazonNextDay: number
}

export function liftoffEstimate(i: EstimateInput): Estimate {
  const measured = typeof i.upMbps === 'number' && Number.isFinite(i.upMbps) && i.upMbps > 0.5
  const up = measured ? Math.min(1000, i.upMbps as number) : DEFAULT_UP_MBPS
  // Downloads are usually several times faster than uploads at home.
  const down = Math.max(up * 3, 50)
  const known = i.bytes.filter((b): b is number => typeof b === 'number' && b > 0)
  // An unknown size counts as the average of the known ones.
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 300 * 1024 * 1024
  const sizes = i.bytes.map((b) => (typeof b === 'number' && b > 0 ? b : avg))
  const secs = (bytes: number, mbps: number) => (bytes * 8) / (mbps * 1_000_000)
  let total = 0
  for (const b of sizes) {
    if (i.youtube === 'studio') total += secs(b, down) + secs(b, up) + STUDIO_FILL_MIN * 60
    if (i.youtube === 'api') total += STUDIO_FINISH_MIN * 60
    if (i.amazon) total += secs(b, down) + secs(b, up) + AMAZON_FORM_MIN * 60
  }
  const mins = total / 60
  return {
    minutes: [Math.max(1, Math.round(mins * 0.8)), Math.max(2, Math.round(mins * 1.4))],
    totalBytes: Math.round(sizes.reduce((a, b) => a + b, 0)),
    unknownSizes: i.bytes.length - known.length,
    upMbps: Math.round(up),
    measured,
    amazonNextDay: i.amazon ? Math.max(0, i.bytes.length - AMAZON_US_PER_DAY) : 0,
  }
}

/** "about 20 to 35 minutes", "about 3 to 5 hours". */
export function estimateWords(m: [number, number]): string {
  const [lo, hi] = m
  if (hi < 90) return `about ${lo} to ${hi} minutes`
  const h = (x: number) => Math.max(1, Math.round(x / 60))
  return h(lo) === h(hi) ? `about ${h(hi)} hours` : `about ${h(lo)} to ${h(hi)} hours`
}

/** Long enough that it is worth starting before bed. */
export function overnightWorthy(m: [number, number]): boolean {
  return m[1] >= 120
}

/** Fold a new measurement into the kept speed: the median of the last five,
 *  so one odd upload does not swing the estimate. Pure. */
export function foldSpeed(kept: number[], mbps: number): number[] {
  if (!Number.isFinite(mbps) || mbps <= 0) return kept
  return [...kept, Math.round(mbps * 10) / 10].slice(-5)
}

export function speedOf(kept: number[]): number | null {
  if (!kept.length) return null
  const s = [...kept].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
