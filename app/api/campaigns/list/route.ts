/**
 * GET /api/campaigns/list
 * Returns the user's campaign posts, newest first.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { tierAllowsFinders, type Tier } from '@/lib/tier'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // AMZ Product Finder (Source & Earn) is Studio + Pro only. 2026-07-07.
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!tierAllowsFinders((intRow?.tier as Tier) ?? 'trial')) {
    return NextResponse.json({ error: 'The AMZ Product Finder requires a paid plan.', campaigns: [] }, { status: 403 })
  }

  // Columns the queue never works without. Everything else is optional and may be
  // missing on an account whose DB is a migration behind the deploy.
  const CORE_COLS = ['id', 'asin', 'status', 'created_at']
  const OPTIONAL_COLS = [
    'cc_campaign_id', 'product_title', 'campaign_name', 'brand_name', 'epc',
    'program', 'commission_pct', 'monthly_sales', 'has_carousel_video',
    'carousel_video_pos', 'details_url', 'ends_at', 'error_message',
    'wordpress_url', 'blog_post_id', 'category', 'hero_kind', 'product_price',
    'messaged_at', 'last_message', 'accepted_at', // migrations 157/158/159
  ]

  // Fetch campaigns, resilient to ANY migration lag: if the select errors because
  // a column doesn't exist yet (e.g. last_message before mig 158), drop just that
  // column and retry — never let one un-run migration blank the whole queue.
  const fetchCampaigns = async () => {
    let cols = [...CORE_COLS, ...OPTIONAL_COLS]
    // At most one retry per optional column, plus a safety margin.
    for (let attempt = 0; attempt <= OPTIONAL_COLS.length; attempt++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (supabase as any)
        .from('campaigns')
        .select(cols.join(','))
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500)
      if (!res.error) return res
      const m = (res.error.message || '').match(/column\s+"?(?:[\w]+\.)*(\w+)"?\s+does not exist/i)
      if (!m) return res // not a missing-column error — surface it
      const missing = m[1]
      const next = cols.filter(c => c !== missing)
      if (next.length === cols.length || next.length <= CORE_COLS.length) return res // couldn't drop it → give up
      cols = next
    }
    // Last resort: core columns only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (supabase as any)
      .from('campaigns')
      .select(CORE_COLS.join(','))
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500)
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
