/**
 * GET /api/collaborations/list — the user's saved collaboration pitches,
 * newest first. Also returns which platforms they have connected so the
 * form can render the right checkboxes.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  const supabase = await createServerClient()
  // 2026-06-09 Phase 2 (VA): collaborations + brand + integrations live
  // on the owner — surface them when a VA opens /collaborations.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: rows }, { data: intg }, { data: brand }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase
      .from('collaborations')
      .select('id,brand_name,platforms,generated_email,created_at')
      .eq('user_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(100),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase
      .from('integrations')
      .select('facebook_page_id,threads_access_token,twitter_access_token,linkedin_access_token,bluesky_handle,telegram_channel_id,pinterest_access_token,instagram_user_id,tiktok_access_token')
      .eq('user_id', ownerId)
      .single(),
    // Cast through `any` because contact_whatsapp/wechat/lark were added
    // in migration 096; the generated Database types in this branch don't
    // know about them yet. Next types-regen pass will let us drop the cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('brand_profiles')
      .select('website_url,youtube_channel_url,instagram_url,tiktok_url,facebook_url,pinterest_url,threads_url,twitter_url,amazon_storefront_url,linktree_url,collab_track_record,collab_example_links,collab_extra_notes,collab_livestreams,collab_livestream_link,contact_whatsapp,contact_wechat,contact_lark')
      .eq('user_id', ownerId)
      .single(),
  ])

  // A platform shows up as a "Your offer" pill if EITHER:
  //   - the creator has OAuth-connected it (token in integrations), OR
  //   - they've listed a profile URL on brand_profiles
  // The OR is important — many creators have a real Twitter/Facebook
  // presence they post to manually without ever connecting OAuth in MVP,
  // and they still want to offer that channel in collab pitches. Only
  // checking the OAuth side hid those from the pill row even when the
  // URL was clearly filled in on their Brand Profile.
  //
  // LinkedIn, Bluesky, and Telegram have no profile-URL twin on
  // brand_profiles today, so they remain OAuth-only. If we ever add
  // those URL columns, expand the union below.
  const platforms = [
    brand?.website_url && 'Blog',
    brand?.youtube_channel_url && 'YouTube',
    (intg?.instagram_user_id || brand?.instagram_url) && 'Instagram',
    (intg?.tiktok_access_token || brand?.tiktok_url) && 'TikTok',
    (intg?.facebook_page_id || brand?.facebook_url) && 'Facebook',
    (intg?.threads_access_token || brand?.threads_url) && 'Threads',
    (intg?.twitter_access_token || brand?.twitter_url) && 'X',
    (intg?.pinterest_access_token || brand?.pinterest_url) && 'Pinterest',
    intg?.linkedin_access_token && 'LinkedIn',
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
      portfolioUrl: brand?.linktree_url ?? '',
      // Media kit URL — set once on Brand Profile, pre-fills the
      // collab form so the user doesn't retype on every pitch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mediaKitUrl: ((brand as any)?.media_kit_url as string | null | undefined) ?? '',
      collabsDone: brand?.collab_track_record ?? '',
      exampleLinks: Array.isArray(brand?.collab_example_links) ? brand.collab_example_links : [],
      extraNotes: brand?.collab_extra_notes ?? '',
      livestreams: !!brand?.collab_livestreams,
      livestreamLink: brand?.collab_livestream_link ?? '',
      whatsapp: brand?.contact_whatsapp ?? '',
      wechat: brand?.contact_wechat ?? '',
      lark: brand?.contact_lark ?? '',
    },
  })
}
