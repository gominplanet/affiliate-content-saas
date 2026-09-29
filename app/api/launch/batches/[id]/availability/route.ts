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
// The answer comes from lib/regional-listing: the same ASIN first (the same
// stock check the coverage grid uses, so the two cannot disagree), then, where
// that says "not sold", the same product under the country's own ASIN, by
// barcode, then by brand and model or name. Cached across creators, then Keepa
// within a small budget. A country only reads "not sold" once all of it was
// tried.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MARKETS } from '@/lib/markets'
import { normalizeTier } from '@/lib/tier'
import { availabilityKey } from '@/lib/product-availability'
import { lookupRegional, type RegionalAnswer } from '@/lib/regional-listing'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Keepa lookups one page load may pay for. Ten videos across eight
 *  Keepa countries is eighty at most, and most come from the shared cache. */
const LOOKUP_BUDGET = 80
/** Brand-and-name searches one page load may pay for (about ten tokens each).
 *  What is left over is "not checked yet" and answered on the next open. */
const SEARCH_BUDGET = 8

export type ProductVerdict = 'sold' | 'out_of_stock' | 'not_sold' | 'cannot_check' | 'not_checked'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // PRO, like every other Launch Batch route: this spends shared Keepa tokens.
  const { data: integ } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!['pro', 'admin'].includes(normalizeTier(integ?.tier))) {
    return NextResponse.json({ error: 'Liftoff is a Pro feature.' }, { status: 403 })
  }
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
    ? await lookupRegional(admin, pairs, { lookupBudget: LOOKUP_BUDGET, searchBudget: SEARCH_BUDGET })
    : { answers: new Map<string, RegionalAnswer>(), skipped: 'keepa_unconfigured' as const }

  // FIVE ANSWERS, never folded into two. "Not sold" is a fact about Amazon;
  // "cannot check" (Australia has no data source) and "not checked" (no
  // budget, no key, a search still owed) are facts about us, and reading
  // either as "not sold" would tell a creator to skip a country that may well
  // sell the product.
  const answer = (asin: string, domain: string): RegionalAnswer =>
    answers.get(availabilityKey(asin, domain)) ?? { verdict: 'not_checked', localAsin: null, how: null }
  return NextResponse.json({
    ok: true,
    skipped: skipped ?? null,
    videos: items.map((i) => ({ id: i.id, title: i.title || 'Untitled' })),
    markets: MARKETS.map((m) => ({
      domain: m.domain,
      byVideo: items.map((i) => {
        const a = answer(String(i.asin).trim().toUpperCase(), m.domain)
        return { id: i.id, verdict: a.verdict as ProductVerdict, localAsin: a.localAsin, how: a.how }
      }),
    })),
  })
}
