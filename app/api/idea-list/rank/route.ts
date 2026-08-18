// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/idea-list/rank   { listId }  (or { items:[{asin,title,image}] })
//
// Returns EVERY product in the idea list, enriched and ranked by MVP's criteria
// (CC-campaign products first, then price/rating/reviews/demand/deal), so the
// creator can hand-pick which ones go in the guide with the ranking to guide
// them. Paid tiers only. No AI, no publishing — this just reads + ranks.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { enrichAndRankIdeaList, type RankInItem } from '@/lib/idea-list-rank'
import { fetchIdeaList } from '@/lib/amazon-idea-list'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any

    const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    const tier = normalizeTier(intRow?.tier) as Tier
    if (tier === 'trial') return NextResponse.json({ error: 'Turning idea lists into posts is a paid feature.' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { listId?: string; items?: RankInItem[]; listUrl?: string }

    let inItems: RankInItem[] = Array.isArray(body.items) ? body.items : []
    let title: string | null = null
    let listUrl = (body.listUrl || '').trim()
    if (inItems.length === 0 && (body.listId || '').trim()) {
      const { data: row } = await sb.from('idea_lists')
        .select('title,url,items').eq('id', body.listId!.trim()).eq('user_id', user.id).maybeSingle()
      if (!row) return NextResponse.json({ error: 'That synced list is no longer available.' }, { status: 404 })
      inItems = Array.isArray(row.items) ? row.items : []
      title = row.title ?? null
      if (!listUrl && row.url) listUrl = String(row.url)
    }
    // On-demand list with nothing synced yet → read the list URL server-side
    // (first ~20 products), mirroring the generate route. Without this the manual
    // "Load & rank" dead-ended whenever SCOUT hadn't pre-populated the items.
    if (inItems.length === 0 && listUrl) {
      try {
        const parsed = await fetchIdeaList(listUrl)
        inItems = Array.isArray(parsed.items) ? parsed.items : []
        if (!title && parsed.title) title = parsed.title
      } catch { /* fall through to the empty-list message below */ }
    }
    if (inItems.length < 1) return NextResponse.json({ error: 'This list has no products synced yet. Open it on Amazon with SCOUT first.' }, { status: 400 })

    // Rank the whole list (generous cap so it's every product, not the first 20).
    const { ranked } = await enrichAndRankIdeaList(sb, user.id, inItems, { cap: 200 })

    const products = ranked.map((p, i) => ({
      asin: p.asin,
      title: p.title,
      image: p.image,
      priceCents: p.priceCents,
      rating: p.rating,
      reviews: p.reviews,
      discountPct: p.discountPct,
      hasCampaign: p.hasCampaign,
      rank: i + 1,
    }))
    return NextResponse.json({ ok: true, title, count: products.length, products })
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err, "Couldn't rank this list just now. Please try again.") }, { status: 500 })
  }
}
