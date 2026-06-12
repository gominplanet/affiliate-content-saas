/**
 * GET /api/usage/spend — current-month AI-spend status for the signed-in
 * account (the owner, for VA/agency sub-accounts). Powers the spend meter on
 * the billing page. Read-only; the per-feature caps live in /api/usage.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { spendStatus } from '@/lib/ai-spend'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { data: intRow } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', ownerId)
    .maybeSingle()

  const status = await spendStatus(ownerId, intRow?.tier)
  return NextResponse.json({
    spent: Number(status.spent.toFixed(2)),
    ceiling: status.ceiling,
    fraction: Number(status.fraction.toFixed(4)),
    exceeded: status.exceeded,
    tier: status.tier,
  })
}
