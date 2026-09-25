// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/live/products — the products an Amazon Live show can be built
// from: the creator's STOREFRONT. LABS preview (admin while testing).
//
// THE STOREFRONT, NOT EVERYTHING. A live show is products the creator has on
// hand and knows, and the storefront is exactly that list. Each product says
// whether the creator has a video for it (Amazon's own storefront video flag,
// or a YouTube video with that product), whether it is on sale today, and
// what it has earned, which is what "Suggest a lineup" ranks on.
//
// NO STOREFRONT SYNCED YET: the products from the creator's own videos stand
// in, and the page says the storefront is not synced so it can be.

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const covered = await coveredProducts(admin, user.id)
  const youtubeByAsin = new Map(covered.map((p) => [p.asin, p.sources.filter((s) => s.kind === 'video').length]))

  // THE STOREFRONT, with Amazon's own "has a video" flag where the column exists.
  let rows: Array<{ asin: string; title: string | null; image_url: string | null; has_video?: boolean | null }> = []
  {
    const withFlag = await admin.from('storefront_catalog').select('asin,title,image_url,has_video').eq('user_id', user.id).limit(1000)
    if (!withFlag.error) rows = withFlag.data ?? []
    else {
      const plain = await admin.from('storefront_catalog').select('asin,title,image_url').eq('user_id', user.id).limit(1000)
      rows = plain.data ?? []
    }
  }
  const storefrontSynced = rows.length > 0

  // What each product has earned in the last six months, for the lineup ranking.
  const earned = new Map<string, number>()
  if (storefrontSynced) {
    const since = new Date(Date.now() - 183 * 86_400_000).toISOString().slice(0, 10)
    const { data: e, error: eErr } = await admin.from('storefront_earnings')
      .select('asin,commission_cents').eq('user_id', user.id).gte('period_start', since).limit(20000)
    if (!eErr) for (const r of (e ?? []) as Array<{ asin: string; commission_cents: number | null }>) {
      const a = String(r.asin || '').toUpperCase()
      earned.set(a, (earned.get(a) ?? 0) + Number(r.commission_cents || 0))
    }
  }

  const pool = storefrontSynced
    ? rows.map((r) => ({
        asin: String(r.asin).toUpperCase(),
        title: r.title || String(r.asin),
        image: r.image_url || null,
        storefrontVideo: !!r.has_video,
      }))
    : covered.filter((p) => p.sources.some((s) => s.kind === 'video')).map((p) => ({
        asin: p.asin, title: p.title, image: p.image || p.sources.find((s) => s.thumbnail)?.thumbnail || null, storefrontVideo: false,
      }))

  const sales = new Map((await findSales(admin, pool.map((p) => ({ asin: p.asin, title: p.title, image: p.image, sources: [] })), { keepaCap: 50 }))
    .map((s) => [s.asin, s]))

  const products = pool.map((p) => {
    const s = sales.get(p.asin)
    const videos = youtubeByAsin.get(p.asin) ?? 0
    const hasVideo = p.storefrontVideo || videos > 0
    const earnedCents = earned.get(p.asin) ?? 0
    return {
      asin: p.asin,
      title: s?.title && s.title !== p.asin && p.title === p.asin ? s.title : p.title,
      image: p.image || s?.image || null,
      hasVideo,
      videos,
      saleLabel: s ? saleLabel(s.verdict) : null,
      earnedCents,
      // SUGGEST A LINEUP: on sale today first (the reason to watch now), then
      // what has earned, then what there is a video of.
      score: (s ? 1_000_000 : 0) + Math.min(earnedCents, 999_000) + (hasVideo ? 500 : 0),
    }
  })
  return NextResponse.json({ products, storefrontSynced })
}
