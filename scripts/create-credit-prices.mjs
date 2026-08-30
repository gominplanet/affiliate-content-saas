// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-shot: create (or reuse) the three "your-voice" dub credit blocks in Stripe
// and print the env lines to paste into Vercel. Safe to re-run — each price
// carries a stable lookup_key, so a second run reuses the existing price instead
// of creating a duplicate.
//
// Run wherever STRIPE_SECRET_KEY is available:
//   vercel env pull .env.local   # then:
//   node --env-file=.env.local scripts/create-credit-prices.mjs
// or in a Vercel/Railway shell where the key is already in the environment:
//   node scripts/create-credit-prices.mjs
//
// The key's prefix decides the mode: sk_live_… creates LIVE prices, sk_test_…
// creates test-mode prices. The script prints which mode it is using — read it.

import Stripe from 'stripe'

const KEY = process.env.STRIPE_SECRET_KEY
if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set. Pull it first (vercel env pull .env.local) and run with --env-file, or run this in a shell where the key exists.')
  process.exit(1)
}

const stripe = new Stripe(KEY, { apiVersion: '2026-04-22.dahlia' })
const mode = KEY.startsWith('sk_live_') ? 'LIVE' : KEY.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN'

// [credits, price in USD dollars, env var name]
const BLOCKS = [
  [50, 29, 'STRIPE_PRICE_CREDITS_50'],
  [150, 69, 'STRIPE_PRICE_CREDITS_150'],
  [500, 199, 'STRIPE_PRICE_CREDITS_500'],
]

async function ensureBlock(credits, dollars, envName) {
  const lookupKey = `mvp_dub_credits_${credits}`

  // Reuse an existing price with this lookup_key (idempotent re-runs).
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (existing.data[0]) {
    return { envName, priceId: existing.data[0].id, reused: true }
  }

  const product = await stripe.products.create({
    name: `${credits} Your-Voice Dub Credits`,
    description: `${credits} credits for dubbing Amazon storefront videos in your own cloned voice. 1 credit = 1 geo dub.`,
    metadata: { app: 'mvp', kind: 'dub_credits', credits: String(credits) },
  })

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: dollars * 100, // cents
    currency: 'usd',
    // one-time (no `recurring`) → mode: 'payment' at checkout
    lookup_key: lookupKey,
    metadata: { app: 'mvp', kind: 'dub_credits', credits: String(credits) },
  })

  return { envName, priceId: price.id, reused: false }
}

async function main() {
  console.log(`\nStripe mode: ${mode}  (key prefix ${KEY.slice(0, 8)}…)\n`)
  if (mode === 'UNKNOWN') {
    console.error('That does not look like a Stripe secret key (expected sk_live_… or sk_test_…). Aborting.')
    process.exit(1)
  }

  const results = []
  for (const [credits, dollars, envName] of BLOCKS) {
    try {
      const r = await ensureBlock(credits, dollars, envName)
      results.push(r)
      console.log(`  ${r.reused ? 'reused ' : 'created'}  ${credits} credits ($${dollars})  →  ${r.priceId}`)
    } catch (e) {
      console.error(`  FAILED  ${credits} credits: ${e?.message || e}`)
      process.exit(1)
    }
  }

  console.log(`\nPaste these into Vercel (Project → Settings → Environment Variables), then redeploy:\n`)
  for (const r of results) console.log(`${r.envName}=${r.priceId}`)
  console.log('')
}

main().catch(e => { console.error(e); process.exit(1) })
