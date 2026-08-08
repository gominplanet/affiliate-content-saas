/**
 * POST /api/wayward/link  { asin }
 *
 * Mint a Wayward attributed Amazon link for an ASIN (Labs). Returns the
 * ready-to-share amazon.com/dp/<asin>?maas=… URL measured back to the creator's
 * Wayward account. Optionally cloaked with the user's Geniuslink if connected.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getExternalKey } from '@/lib/external-keys'
import { createWaywardLink } from '@/services/wayward'
import { createGeniuslinkService } from '@/services/geniuslink'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const token = await getExternalKey(supabase, user.id, 'wayward')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your Wayward API key in External Integrations.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({})) as { asin?: string; title?: string; cloak?: boolean }
    const asin = (body.asin || '').trim()
    if (!/^[A-Z0-9]{10}$/i.test(asin)) {
      return NextResponse.json({ ok: false, error: 'A valid 10-character ASIN is required.' }, { status: 400 })
    }

    const minted = await createWaywardLink(token, asin)
    let url = minted.link
    let cloaked = false

    // Optional Geniuslink cloak (same pattern as the Levanta tool), if connected.
    const { data: intRow } = await supabase
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .maybeSingle()
    if (body.cloak !== false && intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        const { url: g } = await genius.createLinkWithCode(url, (body.title || asin).slice(0, 80))
        if (g) { url = g; cloaked = true }
      } catch { /* non-fatal — return the raw Wayward link */ }
    }

    return NextResponse.json({ ok: true, url, waywardUrl: minted.link, linkId: minted.linkId, cloaked })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
