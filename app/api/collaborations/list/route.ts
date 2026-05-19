/**
 * GET /api/collaborations/list — the user's saved collaboration pitches,
 * newest first. Also returns which platforms they have connected so the
 * form can render the right checkboxes.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: rows }, { data: intg }, { data: brand }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('collaborations')
      .select('id,brand_name,platforms,generated_email,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('integrations')
      .select('facebook_page_id,threads_access_token,twitter_access_token,linkedin_access_token,bluesky_handle,telegram_channel_id,pinterest_access_token,instagram_user_id')
      .eq('user_id', user.id)
      .single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('brand_profiles')
      .select('website_url,youtube_channel_url,instagram_url,tiktok_url,amazon_storefront_url,collab_track_record,collab_example_links,collab_extra_notes')
      .eq('user_id', user.id)
      .single(),
  ])

  // Connected = a usable channel the creator can actually deliver on.
  const platforms = [
    brand?.website_url && 'Blog',
    (brand?.youtube_channel_url) && 'YouTube',
    intg?.instagram_user_id && 'Instagram',
    brand?.tiktok_url && 'TikTok',
    intg?.facebook_page_id && 'Facebook',
    intg?.threads_access_token && 'Threads',
    intg?.twitter_access_token && 'X',
    intg?.linkedin_access_token && 'LinkedIn',
    intg?.pinterest_access_token && 'Pinterest',
    intg?.bluesky_handle && 'Bluesky',
    intg?.telegram_channel_id && 'Telegram',
  ].filter(Boolean) as string[]

  return NextResponse.json({
    collaborations: rows ?? [],
    platforms,
    prefill: {
      websiteUrl: brand?.website_url ?? '',
      youtubeUrl: brand?.youtube_channel_url ?? '',
      amazonStorefront: brand?.amazon_storefront_url ?? '',
      collabsDone: brand?.collab_track_record ?? '',
      exampleLinks: Array.isArray(brand?.collab_example_links) ? brand.collab_example_links : [],
      extraNotes: brand?.collab_extra_notes ?? '',
    },
  })
}
