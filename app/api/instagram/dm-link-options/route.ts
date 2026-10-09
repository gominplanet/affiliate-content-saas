// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/instagram/dm-link-options?videoId=&product=
// The links an Auto-DM can send for this clip: the Link in Bio product page,
// the blog post and the affiliate link, each only when it exists. See
// lib/dm-link-options.ts.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { dmLinkOptions } from '@/lib/dm-link-options'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const result = await dmLinkOptions(supabase, user.id, {
    videoId: url.searchParams.get('videoId'),
    product: url.searchParams.get('product'),
  })
  return NextResponse.json(result)
}
