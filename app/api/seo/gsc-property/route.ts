/**
 * GET /api/seo/gsc-property
 *
 * The user's verified Search Console property string (e.g. "https://site.com/"
 * or "sc-domain:site.com"), so a page can deep-link straight into the right
 * Search Console report instead of dumping people at the console root to hunt
 * for their own property.
 *
 * Deliberately tiny: /api/seo/overview also returns this, but it queries
 * WordPress and the GSC analytics API to do it — far too heavy for a page that
 * just wants to render one accurate link on mount.
 *
 * Returns: { property, connected }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integ } = await (supabase as any)
      .from('integrations')
      .select('gsc_property, gsc_oauth_refresh_token')
      .eq('user_id', ownerId)
      .maybeSingle()

    const property: string | null = integ?.gsc_property || null
    return NextResponse.json({
      property,
      connected: !!(property && integ?.gsc_oauth_refresh_token),
    })
  } catch {
    // Never break a page over a convenience link — it falls back to the
    // plain Search Console URL when this returns nothing.
    return NextResponse.json({ property: null, connected: false })
  }
}
