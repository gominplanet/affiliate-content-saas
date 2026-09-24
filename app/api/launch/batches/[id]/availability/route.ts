// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/launch/batches/[id]/availability — for every Amazon country, which
// of this batch's products Amazon actually sells there.
//
// ASKED BEFORE LAUNCH, NOT DISCOVERED AFTER. A batch launched to seven
// countries and six of them turned out not to sell one video's product. Nothing
// was wrong, but nothing had said so either, until a database query did. The
// countries step now shows it while the creator is still choosing.
//
// The answer comes from lib/product-availability, the same function the
// coverage grid uses before it prepares a country, so the two cannot disagree.
// Cache first (free), then Keepa within a small budget.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MARKETS } from '@/lib/markets'
import { availabilityKey, lookupAvailability } from '@/lib/product-availability'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Keepa lookups one page load may pay for. Ten videos across eight
 *  Keepa countries is eighty at most, and most come from the shared cache. */
const LOOKUP_BUDGET = 80

export type ProductVerdict = 'sold' | 'out_of_stock' | 'not_sold' | 'cannot_check' | 'not_checked'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: batch } = await sb.from('launch_batches').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 })
  const { data: rows } = await sb.from('launch_items').select('id,title,asin,position').eq('batch_id', id).order('position')
  const items = ((rows ?? []) as Array<{ id: string; title: string | null; asin: string | null }>)
    .filter((i) => /^[A-Z0-9]{10}$/i.test(String(i.asin || '').trim()))

  const pairs = items.flatMap((i) => MARKETS.map((m) => ({ asin: String(i.asin).trim().toUpperCase(), domain: m.domain })))
  // The shared cache is locked to the service role (migration 294).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any = null
  try { admin = createAdminClient() } catch { admin = null }
  const { answers, skipped } = admin
    ? await lookupAvailability(admin, pairs, { lookupBudget: LOOKUP_BUDGET })
    : { answers: new Map(), skipped: 'keepa_unconfigured' as const }

  // FIVE ANSWERS, never folded into two. "Not sold" is a fact about Amazon;
  // "cannot check" (Australia has no data source) and "not checked" (no
  // budget, no key) are facts about us, and reading either as "not sold" would
  // tell a creator to skip a country that may well sell the product.
  const verdict = (asin: string, domain: string): ProductVerdict => {
    const a = answers.get(availabilityKey(asin, domain))
    if (a === 'in_stock') return 'sold'
    if (a === 'out_of_stock') return 'out_of_stock'
    if (a === 'not_listed') return 'not_sold'
    if (a === 'no_answer') return 'cannot_check'
    return 'not_checked'
  }
  return NextResponse.json({
    ok: true,
    skipped: skipped ?? null,
    videos: items.map((i) => ({ id: i.id, title: i.title || 'Untitled' })),
    markets: MARKETS.map((m) => ({
      domain: m.domain,
      byVideo: items.map((i) => ({ id: i.id, verdict: verdict(String(i.asin).trim().toUpperCase(), m.domain) })),
    })),
  })
}
