// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Post-opportunity classifier — the "brain" of the revenue loop (Phase 2).
//
// The app already pulls two outcome signals it never acts on:
//   - Search Console (lib/gsc.ts): per-URL position, impressions, CTR, clicks
//   - Geniuslink (services/geniuslink): affiliate-link clicks per post
//
// Today they live on two separate screens (/seo, /analytics) as read-only
// numbers. This module turns the joined metrics for ONE post into a single
// classification + the concrete in-app action that resolves it, so the SEO
// hub can render a prioritised "fix this next" worklist instead of a wall of
// stats. Pure functions, no I/O — the route gathers the metrics, this scores
// them, the UI renders them.
//
// Nothing here is load-bearing for generation; it's an advisory layer.

/** Joined per-post outcome metrics over a fixed window (default last 28d). */
export interface PostMetrics {
  /** GSC average position (1 = top of results). null = no GSC impressions. */
  position: number | null
  /** GSC impressions over the window. */
  impressions: number
  /** GSC search clicks (clicks FROM Google TO the post). */
  searchClicks: number
  /** GSC click-through rate, 0..1 (searchClicks / impressions). */
  ctr: number
  /**
   * Geniuslink affiliate-link clicks attributed to this post over the window.
   * null = we couldn't match a shortlink to the post (distinct from 0 = matched
   * but nobody clicked — the latter is a real, actionable signal).
   */
  affiliateClicks: number | null
  /** URL Inspection verdict. null = not checked (don't infer a problem). */
  indexed: boolean | null
  /** Best (lowest) average position this post has ever recorded
   *  (post_seo.best_position). null = no history yet. Drives decay detection —
   *  a post that peaked on page 1 and has since slipped. */
  bestPosition: number | null
}

/** The kind of opportunity a post represents, in rough priority order. */
export type OpportunityKind =
  | 'not_indexed'            // Google can't show it at all → 0 traffic ceiling
  | 'decaying'               // peaked on page 1, now slipping → refresh to recover
  | 'striking_distance'      // pos 5–15 with demand → a push lands page 1
  | 'low_ctr'                // ranks well, under-clicked → title/meta problem
  | 'ranks_but_no_clickout'  // readers arrive but don't click the affiliate link
  | 'winner'                 // ranks + reads + converts → template to replicate
  | 'low_volume'             // indexed but ~no demand → leave it / consolidate
  | 'no_data'                // not enough signal yet to judge

/** Which existing in-app action resolves an opportunity (links the worklist
 *  row to a real button rather than leaving the user to figure it out). */
export type OpportunityCta =
  | 'index'          // SEO hub "Index" (submitUrlForIndexing)
  | 'rebuild'        // "Rebuild from video" modal
  | 'improve_title'  // /tools/title-audit
  | 'strengthen_cta' // re-gen with a stronger CTA / better product match
  | 'scale'          // find similar products/videos to make more winners
  | 'none'

export interface PostOpportunity {
  kind: OpportunityKind
  /** 0..100 — higher = act sooner. Upside (impressions) × size of the gap. */
  priority: number
  /** Short imperative headline for the worklist row. */
  action: string
  /** One-line plain-English why, with the numbers that triggered it. */
  reason: string
  /** The button that fixes it. */
  cta: OpportunityCta
}

/**
 * Industry-rough expected CTR by average position. Used to detect posts that
 * rank well but get under-clicked (a title/meta problem) vs. posts whose low
 * clicks are simply explained by a low position. Deliberately conservative —
 * these are advisory thresholds, not a model.
 */
export function expectedCtr(position: number): number {
  if (position <= 1) return 0.28
  if (position <= 2) return 0.15
  if (position <= 3) return 0.11
  if (position <= 4) return 0.08
  if (position <= 5) return 0.06
  if (position <= 7) return 0.04
  if (position <= 10) return 0.025
  if (position <= 15) return 0.012
  return 0.006
}

// Tunable thresholds — kept here so they're easy to adjust as real data lands.
const MIN_IMPRESSIONS = 20        // below this, there isn't enough demand to judge CTR
const STRIKING_MIN = 5            // avg position window that a refresh can realistically move
const STRIKING_MAX = 15
const LOW_CTR_RATIO = 0.5         // actual < 0.5× expected(position) = under-clicked
const WINNER_MAX_POSITION = 4     // top-of-page-1 to count as a "winner"
const DECAY_BEST_MAX = 5          // a post must have PEAKED at ≤ this to count as decayed
const DECAY_DROP = 5              // ...and slipped at least this many positions since the peak

/**
 * Classify a single post from its joined metrics. Order matters: the most
 * urgent / highest-upside condition wins, so each post yields exactly one row.
 */
export function classifyPostOpportunity(m: PostMetrics): PostOpportunity {
  // 1. Not indexed — hard ceiling of zero. Nothing else matters until fixed.
  if (m.indexed === false) {
    return {
      kind: 'not_indexed',
      priority: 100,
      action: 'Submit to Google',
      reason: 'Google has not indexed this URL yet — it can rank for nothing until it is crawled.',
      cta: 'index',
    }
  }

  // No demand signal at all → can't judge ranking opportunities yet.
  if (!m.position || m.impressions < MIN_IMPRESSIONS) {
    // Indexed, but essentially no impressions: either brand-new or low-demand.
    return {
      kind: m.impressions > 0 ? 'low_volume' : 'no_data',
      priority: 5,
      action: m.impressions > 0 ? 'Low search demand — fine to leave as-is' : 'Too new to judge',
      reason: m.impressions > 0
        ? `Only ${m.impressions} impressions in 28 days — few people search this topic. Nothing to fix here; just don't prioritize more posts like it.`
        : 'Not enough Search Console data yet. Check back after it accrues impressions.',
      cta: 'none',
    }
  }

  const exp = expectedCtr(m.position)
  const upside = impressionUpside(m.impressions) // 0..1 scaling factor

  // 2. Decaying — the post PEAKED on page 1 and has since slipped. Checked before
  //    striking-distance because it's more specific + higher value: you're LOSING
  //    ranking you already earned, and a refresh recovers it before it slides
  //    further. (A post that never ranked well has no peak, so it can't decay.)
  if (m.bestPosition != null && m.bestPosition <= DECAY_BEST_MAX && (m.position - m.bestPosition) >= DECAY_DROP) {
    return {
      kind: 'decaying',
      priority: clamp(68 + Math.round(upside * 30)),
      action: 'Refresh — it’s slipping from where it ranked',
      reason: `Peaked at position ${m.bestPosition.toFixed(1)} but now sits at ${m.position.toFixed(1)} on ${m.impressions} impressions. Refresh it to recover the lost ranking before it slides further.`,
      cta: 'rebuild',
    }
  }

  // 3. Striking distance — ranks on the cusp (page 1 bottom / page 2) with real
  //    demand. The single best ROI move: a refresh/expansion often lands page 1.
  if (m.position >= STRIKING_MIN && m.position <= STRIKING_MAX) {
    return {
      kind: 'striking_distance',
      priority: clamp(60 + Math.round(upside * 35)),
      action: 'Rebuild & expand — it’s one push from page 1',
      reason: `Averaging position ${m.position.toFixed(1)} on ${m.impressions} impressions. A deeper rebuild can move it onto page 1 where the clicks are.`,
      cta: 'rebuild',
    }
  }

  // 3. Ranks well but under-clicked — strong position, CTR far below what that
  //    position should earn → the title/meta isn't winning the click.
  if (m.position <= 10 && m.ctr < exp * LOW_CTR_RATIO) {
    return {
      kind: 'low_ctr',
      priority: clamp(50 + Math.round(upside * 35)),
      action: 'Rewrite the title & meta',
      reason: `Position ${m.position.toFixed(1)} should earn ~${pct(exp)} CTR but it’s getting ${pct(m.ctr)} on ${m.impressions} impressions — the headline isn’t winning the click.`,
      cta: 'improve_title',
    }
  }

  // 4. Ranks AND gets read, but readers don't click the affiliate link. Only
  //    fire when we actually matched a shortlink (affiliateClicks !== null) and
  //    the post pulled real search clicks — otherwise there's nothing to convert.
  if (m.searchClicks >= 10 && m.affiliateClicks !== null && conversionRate(m) < 0.03) {
    return {
      kind: 'ranks_but_no_clickout',
      priority: clamp(55 + Math.round(upside * 30)),
      action: 'Strengthen the CTA / product match',
      reason: `${m.searchClicks} readers arrived from Google but only ${m.affiliateClicks} clicked the affiliate link (${pct(conversionRate(m))}). The product fit or CTA placement is leaking the most valuable traffic.`,
      cta: 'strengthen_cta',
    }
  }

  // 5. Winner — top of page 1, real clicks, and (if known) converting. Replicate.
  if (m.position <= WINNER_MAX_POSITION && m.searchClicks >= 10 &&
      (m.affiliateClicks === null || conversionRate(m) >= 0.03)) {
    return {
      kind: 'winner',
      priority: clamp(30 + Math.round(upside * 20)),
      action: 'Make more like this',
      reason: `Position ${m.position.toFixed(1)}, ${m.searchClicks} clicks${m.affiliateClicks !== null ? `, ${pct(conversionRate(m))} click-out` : ''}. This format works — replicate it on similar products.`,
      cta: 'scale',
    }
  }

  // Default: indexed, ranking somewhere, nothing screaming. Low priority.
  return {
    kind: 'low_volume',
    priority: clamp(Math.round(upside * 20)),
    action: 'Holding steady — no action needed',
    reason: `Position ${m.position.toFixed(1)} on ${m.impressions} impressions, ${pct(m.ctr)} CTR. Nothing obviously broken.`,
    cta: 'none',
  }
}

/** Sort a batch of classified posts so the worklist leads with the biggest wins. */
export function rankOpportunities<T extends { opportunity: PostOpportunity }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.opportunity.priority - a.opportunity.priority)
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Affiliate-clicks ÷ search-clicks. Guards the divide-by-zero. */
function conversionRate(m: PostMetrics): number {
  if (!m.searchClicks || m.affiliateClicks === null) return 0
  return m.affiliateClicks / m.searchClicks
}

/** Map impression volume to a 0..1 upside factor on a log curve — 50 and 5,000
 *  impressions shouldn't score the same, but it shouldn't be purely linear
 *  either (a 50k-impression post isn't 1000× more urgent than a 50-impression one). */
function impressionUpside(impressions: number): number {
  if (impressions <= 0) return 0
  // log10(impressions) normalised so ~10 → ~0.1 and ~10,000 → ~1.0.
  return clamp01(Math.log10(impressions) / 4)
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))) }
function clamp01(n: number): number { return Math.max(0, Math.min(1, n)) }
function pct(ratio: number): string { return `${(ratio * 100).toFixed(1)}%` }
