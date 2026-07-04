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

  const CAMPAIGN_COLS = 'id,asin,cc_campaign_id,product_title,campaign_name,brand_name,epc,program,commission_pct,monthly_sales,has_carousel_video,carousel_video_pos,details_url,ends_at,status,error_message,wordpress_url,blog_post_id,category,hero_kind,product_price,messaged_at,last_message,created_at'

  // Fetch campaigns, resilient to migration lag: try WITH accepted_at (migration
  // 159), and if that column doesn't exist yet, retry WITHOUT it — otherwise the
  // whole queue would come back empty on any account whose DB is a migration
  // behind the deploy.
  const fetchCampaigns = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base = (cols: string) => (supabase as any)
      .from('campaigns')
      .select(cols)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500)
    let res = await base(`${CAMPAIGN_COLS},accepted_at`)
    if (res.error && /accepted_at|column .* does not exist/i.test(res.error.message || '')) {
      res = await base(CAMPAIGN_COLS)
    }
    return res
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data, error }, { data: intg }, { data: brand }] = await Promise.all([
    fetchCampaigns(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase
      .from('integrations')
      .select('facebook_page_id,threads_access_token,twitter_access_token,linkedin_access_token,bluesky_handle,telegram_channel_id,pinterest_access_token,pinterest_board_id')
      .eq('user_id', user.id)
      .single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase
      .from('brand_profiles')
      .select('niches,custom_categories')
      .eq('user_id', user.id)
      .single(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Which socials the user has connected — campaign rows show pills for
  // these once published. Pinterest uses the one-click auto endpoint
  // (generates the pin image/desc server-side) and needs a board picked.
  const connected = {
    facebook:  !!intg?.facebook_page_id,
    threads:   !!intg?.threads_access_token,
    twitter:   !!intg?.twitter_access_token,
    linkedin:  !!intg?.linkedin_access_token,
    bluesky:   !!intg?.bluesky_handle,
    telegram:  !!intg?.telegram_channel_id,
    pinterest: !!intg?.pinterest_access_token,
  }

  // Real category options for the manual picker: brand niches + the
  // user's custom categories, deduped case-insensitively.
  const seen = new Set<string>()
  const categoryOptions = [
    ...((brand?.niches as string[]) || []),
    ...((brand?.custom_categories as string[]) || []),
  ].filter(c => {
    const k = (c || '').trim().toLowerCase()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })

  return NextResponse.json({ campaigns: data ?? [], connected, categoryOptions })
}
