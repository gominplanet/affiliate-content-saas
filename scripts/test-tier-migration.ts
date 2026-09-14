// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Nobody gets moved to a plan that takes something away.
//
// Creator and Studio became frozen legacy tiers on 2026-09-14 when the product
// went to two plans, Amazon $99 and Pro $199. The obvious-looking move for a
// legacy subscriber is "Creator is cheap, Amazon is the cheap one now, move
// them across". It was nearly made in conversation, and it is catastrophic:
//
//   creator -> amazon  loses 12 caps, INCLUDING postsPerMonth 20 -> 0,
//                      sites 1 -> 0, newsletter 500 -> 0, and the linkedin,
//                      bluesky and threads networks
//
// A Creator subscriber is a BLOGGER. Amazon is blog-free and WordPress-free by
// design (`sites: 0`), so moving one there does not downgrade them, it deletes
// the product they are paying for. Their posts would keep existing and they
// would simply be unable to write another.
//
// Pro is the only safe landing place, and this file proves rather than assumes
// it: Pro must be a superset of every tier on every numeric cap and every
// social network. That is also what makes the two-plan structure coherent —
// if Pro ever stops being a superset, there is a customer somewhere for whom
// upgrading is a downgrade.
import { TIERS, type Tier } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

type Caps = Record<string, unknown>
const NUMERIC_CAPS = Object.keys(TIERS.pro as Caps).filter(k => {
  const v = (TIERS.pro as Caps)[k]
  return typeof v === 'number' || v === null
// price and the spend ceiling are not allowances — a higher plan costing more
// is the point, and a ceiling is a backstop rather than something a customer
// is promised.
}).filter(k => k !== 'price' && k !== 'regularPrice' && k !== 'monthlyAiSpendCeilingUsd')

/** Everything `to` takes away from someone currently on `from`. null = unlimited. */
function losses(from: Tier, to: Tier): string[] {
  const out: string[] = []
  for (const k of NUMERIC_CAPS) {
    const a = (TIERS[from] as Caps)[k] as number | null
    const b = (TIERS[to] as Caps)[k] as number | null
    if (b === null) continue                       // unlimited takes nothing away
    if (a === null) {
      // A null is not always "unlimited". On the trial, postsPerMonth is null
      // because that plan is governed by lifetimeMax (5 posts, ever) instead —
      // the same trap nextTierFor documents, where treating the trial's null as
      // unlimited made the Amazon plan's 0 blog posts look like an upgrade.
      // Reading it as unlimited here would report Pro's 100 a month as a LOSS
      // against a plan that allows five in total.
      if (from === 'trial' && k === 'postsPerMonth') continue
      out.push(`${k}: unlimited -> ${b}`)
      continue
    }
    if (b < a) out.push(`${k}: ${a} -> ${b}`)
  }
  const have = new Set(TIERS[from].socials as readonly string[])
  const get = new Set(TIERS[to].socials as readonly string[])
  for (const s of have) if (!get.has(s)) out.push(`social '${s}' removed`)
  return out
}

// ── Pro is a superset of every plan ─────────────────────────────────────────
//
// The load-bearing property. It is what lets support answer "move them to Pro"
// without checking anything, and it is what makes an upgrade prompt honest.
{
  for (const from of ['trial', 'creator', 'amazon', 'studio'] as const) {
    const lost = losses(from, 'pro')
    check(`pro takes nothing away from ${from}`, lost.length === 0,
      lost.join('; ') + ' — if Pro is not a superset, some customer is being asked to pay more for less')
  }
}

// ── the migration that must never happen ────────────────────────────────────
//
// Asserted as a fact about the tiers rather than a rule in a runbook, because a
// runbook is not what runs on a Tuesday when somebody is doing billing admin.
{
  const lost = losses('creator', 'amazon')
  check('creator -> amazon is still a downgrade, and this test still knows it',
    lost.length > 0,
    'if this ever passes with zero losses the tiers changed shape and this file needs rereading, not deleting')
  check('and the blog is specifically what it takes',
    lost.some(l => l.startsWith('postsPerMonth')) && lost.some(l => l.startsWith('sites')),
    `losses were: ${lost.join('; ')}`)
}

// ── the two sellable plans are ordered ──────────────────────────────────────
//
// Pro at twice the price has to be more on every axis. Pro used to carry 120
// thumbnails against Amazon's 200 — under half the design allowance of the
// cheaper plan — which is exactly the contradiction that made Studio unsellable
// next to Amazon in the first place.
{
  const lost = losses('amazon', 'pro')
  check('pro beats amazon on every cap', lost.length === 0, lost.join('; '))
  check('and costs more', TIERS.pro.price > TIERS.amazon.price,
    `pro $${TIERS.pro.price} vs amazon $${TIERS.amazon.price}`)
}

// ── the frozen tiers are still readable ─────────────────────────────────────
//
// Frozen means "nobody new can buy one", NOT "deleted". Five paying
// subscribers hold these values in the database and in Stripe metadata. A
// normalizeTier that stopped recognising them would drop those accounts to the
// free trial silently, mid-billing-period.
{
  for (const t of ['creator', 'studio'] as const) {
    check(`${t} still exists with its allowances`,
      !!TIERS[t] && TIERS[t].price > 0 && (TIERS[t].postsPerMonth ?? 0) > 0,
      'a legacy subscriber keeps the plan they bought until they choose to move')
  }
}

if (failures.length) {
  console.error(`\n❌ tier-migration: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ tier-migration: Pro takes nothing away from anyone, creator -> amazon is still known to be a downgrade, and the frozen tiers still hold their allowances')
