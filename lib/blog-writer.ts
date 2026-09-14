// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH MODEL WRITES THE BLOG POST.
//
// blog_generate is the single biggest line in the whole AI bill: 36% of 90-day
// spend, $0.4673 a post. Sonnet 5 is $2/$10 against Opus's $5/$25, exactly 0.4x
// on both input and output, so moving the writer there is about $1,150 a year.
//
// That is the only lever in the audit that actually bets product quality. The
// blog publishes to the creator's own domain under their own name, so a drop in
// prose shows up as churn months later rather than as a number anybody sees.
// You do not take that bet on a hunch, and you do not take it all at once.
//
// So: a slice. BLOG_WRITER_TRIAL_PCT of posts are written by the trial model,
// the rest by the default, and blog_quality_checks records which arm wrote each
// post so the comparison is per-post and exact rather than inferred from
// timestamps.
//
// Two properties that matter more than they look:
//
//   DETERMINISTIC PER VIDEO, not random per call. A generation that fails and
//   retries must land in the SAME arm, or a model that fails more often quietly
//   launders its failures into the other arm's results. Hashing the video id
//   gives that for free.
//
//   DEFAULT OFF. TRIAL_PCT unset means 0, which means every post is written by
//   the default model and nothing about today's behaviour changes. The trial
//   starts when somebody sets an env var, not when this file ships.
import { createHash } from 'node:crypto'

/** The production writer. Opus 5 is the current generation at exactly the same
 *  list price as the 4.8 it replaced ($5/$25), so this move cost nothing. */
export const BLOG_WRITER_DEFAULT = 'claude-opus-5'

/** The cheaper writer under trial. $2/$10 — 0.4x Opus on both rates. */
export const BLOG_WRITER_TRIAL = 'claude-sonnet-5'

export type WriterArm = 'default' | 'trial'

export interface WriterChoice {
  /** The Anthropic model id to generate with. */
  model: string
  /** Which arm this post is in. Recorded on blog_quality_checks so the
   *  scoreboard can group by it. */
  arm: WriterArm
}

/**
 * Read the trial percentage. Anything unparseable, negative, or absent is 0:
 * a typo in an env var must fail CLOSED (everyone on the default writer), never
 * open. Clamped to 100 at the top.
 */
export function blogWriterTrialPct(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.BLOG_WRITER_TRIAL_PCT ?? '').trim()
  if (!raw) return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, Math.floor(n))
}

/**
 * Which model writes this post.
 *
 * `seed` should be the video id (stable across retries of the same post). An
 * empty seed always returns the default arm: with nothing stable to hash, a
 * random assignment would flip between retries and pollute both arms, and the
 * safe side of that coin is the writer we already trust.
 */
export function pickBlogWriter(
  seed: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): WriterChoice {
  const pct = blogWriterTrialPct(env)
  if (pct <= 0) return { model: BLOG_WRITER_DEFAULT, arm: 'default' }
  const s = (seed ?? '').trim()
  if (!s) return { model: BLOG_WRITER_DEFAULT, arm: 'default' }
  if (pct >= 100) return { model: BLOG_WRITER_TRIAL, arm: 'trial' }

  // First 4 bytes of sha256, mod 100. Stable for a given seed forever, and
  // evenly spread, which a naive charCode sum is not.
  const digest = createHash('sha256').update(s).digest()
  const bucket = digest.readUInt32BE(0) % 100
  return bucket < pct
    ? { model: BLOG_WRITER_TRIAL, arm: 'trial' }
    : { model: BLOG_WRITER_DEFAULT, arm: 'default' }
}
