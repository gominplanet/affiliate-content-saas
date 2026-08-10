// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/amazon/pin-copy — write the Pin title + description for a product so
// the composer can pre-fill the boxes WHILE the image is rendering. The creator
// then just posts or schedules (or tweaks the copy first). Cheap Haiku call.
//
// Body: { asin?, productUrl?, productTitle? } → { title, description }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { writePinCopy } from '@/lib/amazon-pin-publish'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { asin?: string; productUrl?: string; productTitle?: string }

  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = ((intRow as { tier?: string } | null)?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json({ error: 'Not on your plan.' }, { status: 403 })
  }

  const copy = await writePinCopy({ userId: user.id, tier, productTitle: body.productTitle, productUrl: body.productUrl, asin: body.asin })
  return NextResponse.json({ ok: true, ...copy })
}
