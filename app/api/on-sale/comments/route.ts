// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/on-sale/comments — the sale comments MVP posted for this creator,
// newest first, each with what actually happened to it: still on sale,
// updated after the sale ended, gone from YouTube, or failed and why. LABS.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'

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
  return NextResponse.json({ comments: data ?? [] })
}
