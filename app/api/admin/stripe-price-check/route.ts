// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/stripe-price-check  (admin only)
//
// Diagnostic: reports which STRIPE_PRICE_* env vars the RUNNING server sees, and
// whether the Stripe secret key is live or test — so a "Invalid tier" checkout
// (which fires when a price env is missing) can be diagnosed without guessing
// about Vercel env scoping / redeploys. Never returns the actual price IDs or the
// secret key: only set/unset, valid-format, last-4, and the key MODE.
//
// AND WHAT STRIPE WILL ACTUALLY CHARGE. This used to stop at "the var is set and
// well formed", which is true of a var pointing at a price for the wrong amount.
// The Amazon plan was raised to $99 in lib/tier and the checkout went on taking
// $79, because a Stripe price is immutable: raising it means creating a NEW
// price and repointing the var, and the var was never repointed. Nothing on the
// site could see it. The pricing page advertised $99, the guards agreed with
// each other, and every new subscriber paid $20 a month less than the plan they
// read about — on founder pricing, which is locked for the life of the
// subscription.
//
// So each id is now fetched from Stripe and its unit_amount compared to
// TIERS[tier].price. The comparison is the point; the rest is context.
import { NextResponse } from 'next/server'
import { priceIdsFor, getStripe, PRICE_ID_LIST } from '@/lib/stripe'
import { CREDIT_BLOCKS } from '@/lib/credit-blocks'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, TIERS, type Tier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEYS = [
  'STRIPE_PRICE_CREATOR',
  'STRIPE_PRICE_STARTER',
  'STRIPE_PRICE_STUDIO',
  'STRIPE_PRICE_PRO',
  'STRIPE_PRICE_AMAZON',
] as const

const isValid = (v?: string) => typeof v === 'string' && /^price_[A-Za-z0-9]+$/.test(v.trim())

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  // A var may hold a COMMA-SEPARATED LIST: the first id is what new buyers are
  // charged, the rest are old prices live subscribers are still on, kept so the
  // webhook's price-to-tier map still recognises them (lib/stripe priceIdsFor).
  // Reporting only the whole string would call "price_new,price_old" malformed.
  const env: Record<string, {
    set: boolean; validFormat: boolean; count: number
    charges: string | null; last4: string[]; malformed: string[]
  }> = {}
  for (const k of KEYS) {
    const raw = process.env[k]
    const ids = priceIdsFor(raw)
    const malformed = ids.filter(id => !isValid(id))
    env[k] = {
      set: !!raw,
      // Valid means: at least one id, and EVERY id well formed. One bad entry
      // in the list is a bad entry, not a rounding error.
      validFormat: ids.length > 0 && malformed.length === 0,
      count: ids.length,
      // Which one a new buyer is actually charged.
      charges: ids[0] ? ids[0].slice(-4) : null,
      last4: ids.map(id => id.slice(-4)),
      malformed: malformed.map(id => id.slice(0, 12)),
    }
  }

  // ── what Stripe will actually charge ─────────────────────────────────────
  //
  // Best-effort and per-id: one unreachable price must not blank the whole
  // report, because the report is what someone opens when something is already
  // wrong. A price that cannot be read says so rather than reading as agreeing.
  const TIER_FOR: Partial<Record<(typeof KEYS)[number], Tier>> = {
    STRIPE_PRICE_CREATOR: 'creator',
    STRIPE_PRICE_STUDIO: 'studio',
    STRIPE_PRICE_PRO: 'pro',
    STRIPE_PRICE_AMAZON: 'amazon',
  }
  const charged: Record<string, {
    tier: string; expectedUsd: number | null; chargesUsd: number | null
    matches: boolean | null; currency: string | null; interval: string | null; error?: string
  }> = {}
  let stripe: ReturnType<typeof getStripe> | null = null
  try { stripe = getStripe() } catch { stripe = null }

  for (const k of KEYS) {
    const tier = TIER_FOR[k]
    if (!tier) continue
    // THE ID CHECKOUT ACTUALLY USES, not a fresh read of the env var.
    //
    // This read process.env[k] directly, while lib/stripe resolves Creator as
    // STRIPE_PRICE_CREATOR ?? STRIPE_PRICE_STARTER. With only STARTER set in
    // production, the report said Creator had "no price id set" and marked it
    // unchecked, for a price the webhook maps and every grandfathered Creator
    // subscriber is billed on. Two wrong answers in one row: it implied those
    // subscribers were unmapped, and it never compared their real price to the
    // advertised $49, which is the one thing this route exists to do.
    // Resolving through PRICE_ID_LIST makes the diagnostic check the same id
    // checkout charges, by construction.
    const first = PRICE_ID_LIST[tier as keyof typeof PRICE_ID_LIST]?.[0]
    const expectedUsd = (TIERS[tier] as { price?: number }).price ?? null
    if (!first || !stripe) {
      charged[k] = { tier, expectedUsd, chargesUsd: null, matches: null, currency: null, interval: null,
        error: !first ? 'no price id set' : 'Stripe client unavailable' }
      continue
    }
    try {
      const price = await stripe.prices.retrieve(first)
      const chargesUsd = typeof price.unit_amount === 'number' ? price.unit_amount / 100 : null
      charged[k] = {
        tier,
        expectedUsd,
        chargesUsd,
        // null, not false, when either side is unknown: "we could not check" and
        // "it is wrong" are different answers and only one is an emergency.
        matches: chargesUsd == null || expectedUsd == null ? null : chargesUsd === expectedUsd,
        currency: price.currency ?? null,
        interval: price.recurring?.interval ?? null,
      }
    } catch (e) {
      charged[k] = { tier, expectedUsd, chargesUsd: null, matches: null, currency: null, interval: null,
        error: e instanceof Error ? e.message.slice(0, 160) : 'lookup failed' }
    }
  }
  // ── and the credit packs, which had no check at all ──────────────────────
  //
  // Same immutable-price trap, one screen further in: three buttons that open a
  // Stripe checkout with their amount typed beside them. Nothing here compared
  // them to anything until the advertised number moved into CREDIT_BLOCKS.usd,
  // so a repriced pack would have kept selling at the old label indefinitely,
  // which is the $79-against-$99 failure with a smaller number on it.
  for (const [block, cfg] of Object.entries(CREDIT_BLOCKS)) {
    const key = cfg.priceEnv
    const first = priceIdsFor(process.env[key])[0]
    const label = `credits:${block}`
    if (!first || !stripe) {
      charged[key] = { tier: label, expectedUsd: cfg.usd, chargesUsd: null, matches: null, currency: null, interval: null,
        error: !first ? 'no price id set' : 'Stripe client unavailable' }
      continue
    }
    try {
      const price = await stripe.prices.retrieve(first)
      const chargesUsd = typeof price.unit_amount === 'number' ? price.unit_amount / 100 : null
      charged[key] = {
        tier: label,
        expectedUsd: cfg.usd,
        chargesUsd,
        matches: chargesUsd == null ? null : chargesUsd === cfg.usd,
        currency: price.currency ?? null,
        // A credit pack is a ONE-TIME price, so no interval is correct here.
        // Reporting 'one-time' rather than null keeps it distinguishable from
        // "we could not read the interval", which is the whole habit this
        // route is built on.
        interval: price.recurring?.interval ?? 'one-time',
      }
    } catch (e) {
      charged[key] = { tier: label, expectedUsd: cfg.usd, chargesUsd: null, matches: null, currency: null, interval: null,
        error: e instanceof Error ? e.message.slice(0, 160) : 'lookup failed' }
    }
  }

  const mismatched = Object.entries(charged).filter(([, v]) => v.matches === false).map(([k]) => k)
  const unchecked = Object.entries(charged).filter(([, v]) => v.matches === null).map(([k]) => k)

  const sk = process.env.STRIPE_SECRET_KEY || ''
  const secretKeyMode = sk.startsWith('sk_live') ? 'live' : sk.startsWith('sk_test') ? 'test' : (sk ? 'unknown-prefix' : 'MISSING')

  return NextResponse.json({
    ok: true,
    // The one that matters for the Amazon checkout right now:
    amazonReady: env.STRIPE_PRICE_AMAZON.set && env.STRIPE_PRICE_AMAZON.validFormat,
    secretKeyMode,
    // THE HEADLINE. Any plan here is charging an amount the product does not
    // advertise, which is either money left on the table or a customer
    // overcharged, and both are worse than an outage because neither shows up.
    priceMismatch: mismatched,
    priceUnchecked: unchecked,
    charged,
    env,
    chargedNote: 'chargesUsd is what Stripe bills for the FIRST id in each var; expectedUsd is TIERS[tier].price. matches=false is a live pricing error: a Stripe price is immutable, so fixing it means creating a new price at the right amount and putting its id FIRST in the var, keeping the old id after it so existing subscribers stay mapped. matches=null means it could not be checked, which is not the same as agreeing.',
    note: 'amazonReady=false means STRIPE_PRICE_AMAZON is not reaching this deployment. Confirm it is on Production and redeploy. Ensure its Stripe mode matches secretKeyMode above.',
    listNote: 'Each var may hold a comma-separated list. `charges` is the last 4 of the id NEW buyers are charged (the first in the list); `last4` is every id the webhook will still map to that tier, which is how subscribers on a retired price keep theirs.',
  })
}
