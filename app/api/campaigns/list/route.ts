/**
 * GET /api/campaigns/list
 * Returns the user's campaign posts, newest first.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data, error }, { data: intg }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('campaigns')
      .select('id,asin,product_title,campaign_name,epc,ends_at,status,error_message,wordpress_url,blog_post_id,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('integrations')
      .select('facebook_page_id,threads_access_token,twitter_access_token,linkedin_access_token,bluesky_handle,telegram_channel_id')
      .eq('user_id', user.id)
      .single(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Which text socials the user has connected — campaign rows show pills
  // for these once published. (Instagram/Pinterest need their own image
  // flow; not in this v1.)
  const connected = {
    facebook: !!intg?.facebook_page_id,
    threads:  !!intg?.threads_access_token,
    twitter:  !!intg?.twitter_access_token,
    linkedin: !!intg?.linkedin_access_token,
    bluesky:  !!intg?.bluesky_handle,
    telegram: !!intg?.telegram_channel_id,
  }

  return NextResponse.json({ campaigns: data ?? [], connected })
}
