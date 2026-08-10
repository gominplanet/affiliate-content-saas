// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/amazon/social-status — one call that tells the Social Influencer page
// which of the three networks are connected, so the connect strip above the
// columns can show the right state without three separate round-trips.
//
// Returns: { pinterest: {connected, name}, instagram: {connected, name},
//            facebook: {connected, name} }
//   name is the handle/board/page we can show next to "Connected".
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: raw } = await supabase
    .from('integrations')
    .select('pinterest_access_token,pinterest_board_name,instagram_user_id,instagram_username,facebook_page_id,facebook_page_name')
    .eq('user_id', user.id).maybeSingle()
  const row = decryptIntegrationRow(raw) as {
    pinterest_access_token?: string | null
    pinterest_board_name?: string | null
    instagram_user_id?: string | null
    instagram_username?: string | null
    facebook_page_id?: string | null
    facebook_page_name?: string | null
  } | null

  return NextResponse.json({
    pinterest: {
      connected: !!row?.pinterest_access_token,
      name: row?.pinterest_board_name || null,
    },
    instagram: {
      connected: !!row?.instagram_user_id,
      name: row?.instagram_username ? `@${row.instagram_username}` : null,
    },
    facebook: {
      connected: !!row?.facebook_page_id,
      name: row?.facebook_page_name || null,
    },
  })
}
