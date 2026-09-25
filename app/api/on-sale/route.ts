// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/on-sale — the products this creator has covered that are on sale
// right now, each with the videos (and storefront) it appears in. LABS.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { coveredProducts, findSales, videoVisibility, applyVisibility, type SaleCheckStats } from '@/lib/covered-sales'
import { detectShorts } from '@/lib/shorts-detect'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('on_sale', intg?.tier)) {
    return NextResponse.json({ error: 'Encore is part of the Pro plan.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const admin = createAdminClient()
  const covered = await coveredProducts(admin, user.id)
  // WHAT WAS ACTUALLY CHECKED, said beside the result: a product past the
  // Keepa cap is "not checked today", which is not the same as "not on sale".
  let stats: SaleCheckStats = { checked: 0, skipped: 0, checkedAsins: [] }
  const found = await findSales(admin, covered, { keepaCap: 50, onStats: (s) => { stats = s } })
  // WHO CAN SEE EACH VIDEO, only for the products on sale: those are the
  // videos a comment would go on. A private or scheduled one is labelled and
  // gets no comment button, since nobody would read a comment there.
  const ids = found.flatMap((p) => p.sources.filter((s) => s.kind === 'video').map((s) => s.youtubeVideoId || ''))
  const vis = await videoVisibility(process.env.YOUTUBE_API_KEY, ids)
  // WHICH ARE SHORTS, for the public ones: a Short's comment links are not
  // clickable, so it is labelled and not offered for a sale comment.
  const shorts = await detectShorts(ids.filter((id) => vis.get(id) === 'public'))
  const onSale = applyVisibility(found, vis, shorts)
  return NextResponse.json({
    covered: covered.length,
    checked: stats.checked,
    skipped: stats.skipped,
    videosCovered: covered.filter((p) => p.sources.some((s) => s.kind === 'video')).length,
    onSale,
    // Said on the page when YouTube could not be asked, so "no label" is
    // never mistaken for "public".
    visibilityChecked: ids.length === 0 || vis.size > 0,
    checkedAt: new Date().toISOString(),
  })
}
