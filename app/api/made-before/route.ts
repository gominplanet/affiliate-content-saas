// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/made-before?asin=B0...&video=<youtube id>&brand=<name>
//   -> { items: MadeItem[] }
//
// What MVP already made for this product, video or brand (lib/made-before),
// so a generator can offer it back before spending on a new one. Reads only,
// on the creator's own session.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { madeBefore } from '@/lib/made-before'

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = new URL(request.url)
  const items = await madeBefore(supabase, user.id, {
    asin: u.searchParams.get('asin'),
    youtubeVideoId: u.searchParams.get('video'),
    brand: u.searchParams.get('brand'),
  })
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
