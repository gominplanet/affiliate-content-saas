// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/coverage/markets — which storefronts this creator wants, and whether
// they can actually reach them.
//
//   GET                              -> { ok, markets: [...] }
//   POST { domain, enabled }         -> tick or untick a market
//   POST { signin: [{domain,status,detail}] } -> record what SCOUT found
//
// TWO DIFFERENT THINGS, KEPT APART. Ticking a market is a decision. Being
// signed in to it is a fact, and only the creator's own browser can establish
// it. A screen that treats them as one promises listings in a country the
// creator cannot reach, and the promise fails at the very last step, after
// everything has already been translated and dubbed for it.
//
// UNTICKING NEVER DELETES. The coverage rows stay, so re-ticking a market later
// does not re-do work that was already done, and a creator who unticks Japan
// for a month does not pay for that month twice.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { MARKETS, marketByDomain } from '@/lib/markets'
import { signinLabel, canDeliver } from '@/lib/storefront-coverage'

export const runtime = 'nodejs'

const VALID_SIGNIN = new Set(['ready', 'not_signed_in', 'not_enrolled', 'unknown'])

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: rows } = await sb.from('storefront_markets')
    .select('domain,enabled,signin_state,signin_detail,signin_at').eq('user_id', user.id)

  const byDomain = new Map<string, { enabled: boolean; signin_state: string; signin_detail: string | null; signin_at: string | null }>()
  for (const r of (rows ?? [])) byDomain.set(r.domain, r)

  // EVERY market MVP delivers to, ticked or not, so the screen is a complete
  // picture rather than a list of what happens to have a row.
  const markets = MARKETS.map((m) => {
    const row = byDomain.get(m.domain)
    const signin = row?.signin_state ?? 'unknown'
    return {
      domain: m.domain,
      code: m.code,
      country: m.country,
      langName: m.langName,
      needsTranslation: m.needsTranslation,
      enabled: row?.enabled ?? false,
      signin,
      signinLabel: signinLabel(signin),
      signinDetail: row?.signin_detail ?? null,
      checkedAt: row?.signin_at ?? null,
      // Said plainly, because it is the difference between a market that will
      // deliver tonight and one that will sit at ready forever.
      deliverable: canDeliver(signin),
    }
  })

  return NextResponse.json({ ok: true, markets })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    domain?: string; enabled?: boolean
    signin?: Array<{ domain?: string; status?: string; detail?: string }>
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const now = new Date().toISOString()

  // ── SCOUT reporting what it found ──────────────────────────────────────────
  if (Array.isArray(body.signin)) {
    const rows = body.signin
      .filter((s) => s.domain && marketByDomain(s.domain))
      .map((s) => ({
        user_id: user.id,
        domain: s.domain!,
        // An unrecognised status becomes 'unknown' rather than being written
        // through. A state nobody defined would render as a blank label and
        // read as "fine".
        signin_state: VALID_SIGNIN.has(String(s.status)) ? String(s.status) : 'unknown',
        signin_detail: s.detail ? String(s.detail).slice(0, 200) : null,
        signin_at: now,
        updated_at: now,
      }))
    if (rows.length === 0) return NextResponse.json({ ok: true, updated: 0 })

    // The tick is NOT touched here. SCOUT reports a fact; it does not get to
    // decide which markets the creator wants.
    const { error } = await sb.from('storefront_markets')
      .upsert(rows, { onConflict: 'user_id,domain', ignoreDuplicates: false })
    if (error) return NextResponse.json({ error: 'Could not save the sign-in check.', detail: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, updated: rows.length })
  }

  // ── the creator ticking a market ───────────────────────────────────────────
  const domain = (body.domain || '').trim()
  if (!domain || !marketByDomain(domain)) {
    return NextResponse.json({ error: 'Pick a marketplace MVP delivers to.' }, { status: 400 })
  }
  const enabled = body.enabled !== false

  const { error } = await sb.from('storefront_markets').upsert({
    user_id: user.id, domain, enabled, updated_at: now,
  }, { onConflict: 'user_id,domain' })
  if (error) return NextResponse.json({ error: 'Could not save that choice.', detail: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, domain, enabled })
}
