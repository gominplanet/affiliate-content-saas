// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SAY WHOSE LIMIT IT IS.
//
// A creator with four YouTube channels signed up, saw one channel slot, and
// concluded MVP handles one channel. He asked whether it could do four. It can
// do ten, on Pro; he was on the free trial, which connects one.
//
// The screen was not lying. It said "Connecting more than one YouTube channel
// is a Pro feature", which is true and which he either did not reach or did not
// read as being about him. What it never said was the number. Somebody holding
// four channels is asking exactly one question, "does it do four", and a
// sentence that names a plan without naming a capacity does not answer it.
//
// The number also has to come from the tier table rather than the copy, because
// a cap written into a sentence is a second source of truth and this codebase
// has already been bitten by several. So the line is built from the same value
// the API enforces.
//
// Three audiences, three sentences:
//
//   on a plan with room      how many are connected, out of how many
//   on a plan at its cap     that they are at it, and what lifts it
//   on a plan capped at one  that this is the plan's limit, not the product's
import { SELLABLE_TIERS, TIERS, type Tier } from '@/lib/tier'

/** The sellable plans that run more than one channel, and the most any runs. */
export function multiChannelPlans(): { names: string[]; max: number } {
  const plans = SELLABLE_TIERS.filter(t => TIERS[t].youtubeChannels > 1)
  return {
    names: plans.map(t => TIERS[t].label),
    max: plans.reduce((m, t) => Math.max(m, TIERS[t].youtubeChannels), 0),
  }
}

export interface ChannelAllowance {
  /** The sentence under the heading. Always says a number. */
  line: string
  /** True when this plan could hold more than it does now. */
  canAddMore: boolean
  /** True when the only way to hold more is a different plan. */
  needsUpgrade: boolean
}

export function channelAllowance(tier: Tier | null | undefined, connected: number): ChannelAllowance {
  const cap = TIERS[(tier && TIERS[tier] ? tier : 'trial') as Tier].youtubeChannels
  const canAddMore = connected < cap
  const { names, max } = multiChannelPlans()
  const upgrade = names.length === 0
    ? 'a paid plan'
    : names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`

  if (cap <= 1) {
    // THE ONE THAT MATTERS. Name the limit AND the ceiling, so a single slot
    // reads as this plan's allowance rather than as all MVP can do.
    return {
      line: max > 1
        ? `Your plan connects one YouTube channel. That is the plan's limit, not the product's: ${upgrade} runs up to ${max} channels from one account, each with its own blog.`
        : `Your plan connects one YouTube channel.`,
      canAddMore,
      needsUpgrade: true,
    }
  }

  if (!canAddMore) {
    return {
      line: `All ${cap} of your plan's YouTube channels are connected. Disconnect one to swap in another.`,
      canAddMore: false,
      needsUpgrade: false,
    }
  }

  return {
    line: `${connected} of ${cap} YouTube channels connected. Set a default, and choose which channel each blog pulls from below.`,
    canAddMore: true,
    needsUpgrade: false,
  }
}
