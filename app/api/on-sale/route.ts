// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/on-sale — the products this creator has covered that are on sale
// right now, each with the videos (and storefront) it appears in. LABS.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUsePreview } from '@/lib/labs-preview'
import { coveredProducts, findSales } from '@/lib/covered-sales'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('on_sale', intg?.tier)) {
    return NextResponse.json({ error: 'On sale now is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const admin = createAdminClient()
  const covered = await coveredProducts(admin, user.id)
  const onSale = await findSales(admin, covered)
  return NextResponse.json({
    covered: covered.length,
    videosCovered: covered.filter((p) => p.sources.some((s) => s.kind === 'video')).length,
    onSale,
    checkedAt: new Date().toISOString(),
  })
}
