/**
 * POST /api/walmart/link — mint a commissionable Walmart tracking link for one
 * item and (if the user has Geniuslink connected) cloak it to a geni.us link.
 * Powers "Copy link" on the Walmart offers cards.
 *
 * Body: { itemId: string, title?: string, fallbackUrl?: string }
 * Returns: { ok, url, cloaked, source }  (source: 'minted' | 'fallback')
 *
 * A minted get_products_link is the only Walmart link with guaranteed
 * attribution (routes through goto.walmart.com/Impact with the sharedid). If
 * minting fails we return the caller's fallback (bare product URL) so the button
 * still copies something, flagged source:'fallback'.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWalmartProductLinks } from '@/services/partnerboost'
import { getExternalKey } from '@/lib/external-keys'
import { createGeniuslinkService } from '@/services/geniuslink'
import { getLinkStyle } from '@/lib/link-cloak'
import { shortenBitly } from '@/lib/bitly'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { itemId?: string; title?: string; fallbackUrl?: string }
    const itemId = (body.itemId || '').trim()
    const fallbackUrl = (body.fallbackUrl || '').trim()
    if (!itemId) return NextResponse.json({ ok: false, error: 'itemId required' }, { status: 400 })

    const token = await getExternalKey(supabase, user.id, 'partnerboost')
    if (!token) {
      return NextResponse.json({ ok: false, needsToken: true, error: 'Connect your PartnerBoost API key in External Integrations.' })
    }

    let url = ''
    let source: 'minted' | 'fallback' = 'fallback'
    try {
      const links = await getWalmartProductLinks(token, [itemId])
      if (links[itemId]) { url = links[itemId]; source = 'minted' }
    } catch { /* fall back below */ }
    if (!url) {
      if (!fallbackUrl) return NextResponse.json({ ok: false, error: 'Could not mint a tracking link for this item.' }, { status: 502 })
      url = fallbackUrl
    }

    // Cloak per the creator's ONE chosen Link style — same treatment as a
    // generated post, so a copied link matches what a post would use. Geniuslink
    // wraps, Bitly shortens, Direct keeps the minted link. Passport doesn't apply
    // (Walmart, no Amazon ASIN, and it would drop the network attribution).
    let cloaked = false
    const { data: intRow } = await supabase
      .from('integrations')
      .select('geniuslink_api_key,geniuslink_api_secret')
      .eq('user_id', user.id)
      .maybeSingle()
    const wlStyle = await getLinkStyle(supabase, user.id)
    if (source === 'minted' && wlStyle.style === 'geniuslink' && intRow?.geniuslink_api_key && intRow?.geniuslink_api_secret) {
      try {
        const genius = createGeniuslinkService(intRow.geniuslink_api_key, intRow.geniuslink_api_secret)
        const { url: cl } = await genius.createLinkWithCode(url, (body.title || 'Walmart').slice(0, 80))
        if (cl) { url = cl; cloaked = true }
      } catch { /* non-fatal — return the un-cloaked minted link */ }
    } else if (source === 'minted' && wlStyle.style === 'bitly' && wlStyle.bitlyToken) {
      try {
        const short = await shortenBitly(wlStyle.bitlyToken, url)
        if (short) { url = short; cloaked = true }
      } catch { /* non-fatal — return the un-cloaked minted link */ }
    }

    return NextResponse.json({ ok: true, url, cloaked, source })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Unexpected error' }, { status: 500 })
  }
}
