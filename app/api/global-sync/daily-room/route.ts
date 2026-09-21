// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/global-sync/daily-room — how many more Amazon will take today, per
// storefront.
//
// BEFORE THE WALL, NOT AT IT. The upload queue already refuses anything over
// the limit and names the storefront, but a creator only finds out at the
// moment they press upload. This is the same numbers, readable while they are
// still choosing countries, so a batch aimed at a store with two slots left
// says so before it is built rather than afterwards.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { dailyRoomFor } from '@/lib/daily-uploads'
import { MARKETS } from '@/lib/markets'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Named storefronts, or all of them. Filtered against the real market list so
  // a typo cannot ask about a store that does not exist.
  const asked = (new URL(req.url).searchParams.get('domains') || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  const domains = asked.length > 0 ? asked : MARKETS.map(m => m.domain)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  return NextResponse.json({ ok: true, dailyRoom: await dailyRoomFor(sb, user.id, domains) })
}
