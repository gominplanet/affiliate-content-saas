// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NEVER NAME A PLAN NOBODY CAN BUY.
//
// Creator and Studio are frozen: five existing subscribers keep them, and
// checkout will not sell one. Thirty-odd upgrade messages still named them:
//
//   "Pinterest is a Studio plan feature. Upgrade to Studio or Pro…"
//   "Upgrade to Creator or higher to fix 404s."
//   "Passport Links is available on the Amazon, Studio, and Pro plans."
//
// Every one of those is shown to somebody who does NOT have the feature, which
// is to say somebody on the free trial, which is to say the only people who
// cannot buy the plan being recommended. The message that exists to convert
// them named a dead end.
//
// Hardcoding "Pro" instead would be the same mistake with a longer fuse, so the
// sentence is built from the plans that are actually for sale and from the
// field the route already gates on. Change a tier's capability and the copy
// follows; retire a plan and it stops being named.

import { SELLABLE_TIERS, TIERS, type Tier } from '@/lib/tier'

type PlanConfig = (typeof TIERS)[Tier]

/** "Amazon", "Pro", "Amazon and Pro" — the sellable plans that satisfy `has`. */
export function plansWith(has: (plan: PlanConfig) => boolean): string {
  const names = SELLABLE_TIERS.filter(t => has(TIERS[t])).map(t => TIERS[t].label)
  if (names.length === 0) return 'a paid plan'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The whole upgrade sentence.
 *
 * `feature` is the thing they just tried, phrased as a subject: "Pinterest
 * auto-publish", "Refresh Images". The plan names come from `has`, so a message
 * cannot recommend a plan that does not have the feature, which is the other
 * half of what went wrong: several of these named a tier that did have it once.
 */
export function upgradeLine(feature: string, has: (plan: PlanConfig) => boolean): string {
  const plans = plansWith(has)
  const s = plans === 'a paid plan' ? 'Upgrade to a paid plan' : `Upgrade to ${plans}`
  return `${feature} is on the ${plans} plan${plans.includes(' and ') ? 's' : ''}. ${s} to use it.`
}

/** Shorter form for a place that already says what was blocked. */
export function availableOn(has: (plan: PlanConfig) => boolean): string {
  const plans = plansWith(has)
  return plans === 'a paid plan' ? 'a paid plan' : `the ${plans} plan${plans.includes(' and ') ? 's' : ''}`
}

/** Does this plan publish to `network`? The gate most of these messages sit on. */
export function hasSocial(plan: PlanConfig, network: string): boolean {
  return (plan.socials as readonly string[]).includes(network)
}
