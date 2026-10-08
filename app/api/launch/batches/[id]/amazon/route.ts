// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launch/batches/[id]/amazon — Liftoff part 2: Start Amazon for a
// batch whose videos are on YouTube. The US store only (lib/launch-batch
// LIFTOFF_AMAZON_MARKET): Global Storefront shows US videos in the other
// countries, so nothing else is queued, whatever the request names.
//
// The work itself is lib/liftoff-amazon-start, shared with the uploader,
// which starts it by itself once YouTube is done.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startAmazonPart } from '@/lib/liftoff-amazon-start'
import { hasVideoTools } from '@/lib/amazon-plan'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!hasVideoTools(integ?.tier)) {
    return NextResponse.json({ error: 'Bulk Amazon upload is part of the Amazon and Pro plans.' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // The per-country ASIN cache is shared across creators and read with the
  // service key, as the availability check reads it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: any = sb
  try { cache = createAdminClient() } catch { /* the plain ASIN is used, and the grid finds local ones */ }
  const r = await startAmazonPart(sb, cache, user.id, id)
  if (!r.ok) return NextResponse.json({ error: r.error, ...(r.started ? { started: r.started } : {}) }, { status: r.status })
  return NextResponse.json({ ok: true, markets: r.markets, started: r.started, rowsMade: r.rowsMade, noOriginal: r.noOriginal, notYet: r.notYet })
}
