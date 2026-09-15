// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/stripe-price-check  (admin only)
//
// Diagnostic: reports which STRIPE_PRICE_* env vars the RUNNING server sees, and
// whether the Stripe secret key is live or test — so a "Invalid tier" checkout
// (which fires when a price env is missing) can be diagnosed without guessing
// about Vercel env scoping / redeploys. Never returns the actual price IDs or the
// secret key: only set/unset, valid-format, last-4, and the key MODE.
import { NextResponse } from 'next/server'
import { priceIdsFor } from '@/lib/stripe'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'

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

  const sk = process.env.STRIPE_SECRET_KEY || ''
  const secretKeyMode = sk.startsWith('sk_live') ? 'live' : sk.startsWith('sk_test') ? 'test' : (sk ? 'unknown-prefix' : 'MISSING')

  return NextResponse.json({
    ok: true,
    // The one that matters for the Amazon checkout right now:
    amazonReady: env.STRIPE_PRICE_AMAZON.set && env.STRIPE_PRICE_AMAZON.validFormat,
    secretKeyMode,
    env,
    note: 'amazonReady=false means STRIPE_PRICE_AMAZON is not reaching this deployment. Confirm it is on Production and redeploy. Ensure its Stripe mode matches secretKeyMode above.',
    listNote: 'Each var may hold a comma-separated list. `charges` is the last 4 of the id NEW buyers are charged (the first in the list); `last4` is every id the webhook will still map to that tier, which is how subscribers on a retired price keep theirs.',
  })
}
