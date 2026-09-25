// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/on-sale/comments — the sale comments MVP posted for this creator,
// newest first, each with what actually happened to it: still on sale,
// updated after the sale ended, gone from YouTube, or failed and why. Plus
// what was posted to socials from the page. LABS.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { SALE_COMMENTS_PER_DAY } from '@/lib/sale-comments'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('on_sale', intg?.tier)) {
    return NextResponse.json({ error: 'On sale now is in Labs testing and not open yet.', code: 'tier_not_allowed' }, { status: 403 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('sale_comments')
    .select('id,asin,youtube_video_id,video_title,comment_id,sale_label,state,pinned,pin_error,last_error,last_checked_at,posted_at,updated_at')
    .eq('user_id', user.id).order('posted_at', { ascending: false }).limit(100)
  if (error) {
    // Said, not hidden: without the table nothing is remembered or updated.
    return NextResponse.json({ comments: [], missingTable: error.code === '42P01', error: error.code === '42P01' ? null : error.message })
  }
  // WHAT WAS SHARED TO SOCIALS from this page, for the "Posted to" tag on
  // each product. The last 60 days: an older share is not this sale's.
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shares } = await (supabase as any).from('on_sale_shares')
    .select('asin,ok_platforms,scheduled_for,created_at').eq('user_id', user.id).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(300)
  // HOW MANY ARE LEFT TODAY, from the same rolling 24 hours the post route counts.
  const dayAgo = Date.now() - 86_400_000
  const postedToday = ((data ?? []) as Array<{ posted_at: string }>).filter((c) => Date.parse(c.posted_at) >= dayAgo).length
  return NextResponse.json({ comments: data ?? [], shares: shares ?? [], postedToday, perDay: SALE_COMMENTS_PER_DAY })
}
