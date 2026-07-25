/**
 * GET /api/youtube/shorts/usage — how many Shorts the user has rendered this
 * billing period vs their monthly cap. Powers the "X / 50 this month" counter in
 * Clip Factory. Admin = unlimited (limit null).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE, SHORTS_MONTHLY_CAP } from '@/lib/usage-cap'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: intRow } = await supabase
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', user.id).single()
  const tier = normalizeTier(intRow?.tier) as Tier
  const limit = tier === 'admin' ? null : SHORTS_MONTHLY_CAP

  const cap = await checkUsageCap(
    supabase, user.id, PRIMARY_FEATURE.short, limit,
    (intRow?.subscription_period_start as string | null) ?? null,
    (intRow?.subscription_period_end as string | null) ?? null,
  )
  const used = cap?.used ?? 0
  return NextResponse.json({
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    resetLabel: cap?.resetLabel ?? '',
  })
}
