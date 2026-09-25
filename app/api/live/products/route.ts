// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/live/products — the products an Amazon Live plan can be built from:
// the creator's videos with a product, their storefront, and their idea lists,
// each flagged when it is on sale today. LABS preview (admin while testing).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { coveredProducts, findSales, saleLabel } from '@/lib/covered-sales'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('amazon_live', intg?.tier)) {
    return NextResponse.json({ error: 'Amazon Live prep is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const admin = createAdminClient()
  const covered = await coveredProducts(admin, user.id)

  // IDEA LISTS, as a third source: often exactly what a live show is.
  const lists: Array<{ id: string; title: string; asins: string[] }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ideas, error: ideaErr } = await (admin as any).from('idea_lists')
    .select('id,title,items').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
  const byAsin = new Map(covered.map((p) => [p.asin, p]))
  if (!ideaErr) {
    for (const l of (ideas ?? []) as Array<{ id: string; title: string | null; items: unknown }>) {
      const items = (Array.isArray(l.items) ? l.items : []) as Array<{ asin?: string; title?: string; image?: string }>
      const asins: string[] = []
      for (const it of items.slice(0, 60)) {
        const a = String(it?.asin || '').trim().toUpperCase()
        if (!/^[A-Z0-9]{10}$/.test(a)) continue
        asins.push(a)
        if (!byAsin.has(a)) byAsin.set(a, { asin: a, title: String(it.title || a), image: it.image || null, sources: [] })
      }
      if (asins.length) lists.push({ id: l.id, title: l.title || 'Idea list', asins })
    }
  }

  const all = [...byAsin.values()]
  const sales = new Map((await findSales(admin, all, { keepaCap: 50 })).map((s) => [s.asin, s]))
  const products = all.map((p) => {
    const s = sales.get(p.asin)
    const video = p.sources.find((x) => x.kind === 'video')
    return {
      asin: p.asin,
      title: s?.title && s.title !== p.asin ? s.title : p.title,
      image: p.image || s?.image || video?.thumbnail || null,
      videos: p.sources.filter((x) => x.kind === 'video').length,
      inStorefront: p.sources.some((x) => x.kind === 'storefront'),
      saleLabel: s ? saleLabel(s.verdict) : null,
    }
  })
  return NextResponse.json({ products, lists })
}
