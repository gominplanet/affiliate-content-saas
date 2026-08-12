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

  const env: Record<string, { set: boolean; validFormat: boolean; last4: string | null }> = {}
  for (const k of KEYS) {
    const v = process.env[k]
    env[k] = { set: !!v, validFormat: isValid(v), last4: v ? v.trim().slice(-4) : null }
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
  })
}
