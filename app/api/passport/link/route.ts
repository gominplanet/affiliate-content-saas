// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/passport/link  { asin?, url?, title? } → { ok, url, code, asin }
//
// Get-or-create the caller's Passport Link (geo-routing short link) for a product,
// tied to their ACTIVE site so that site's country tags apply. Accepts either a
// raw ASIN (the card "Get link" buttons) or a pasted product link (the paste box):
// an Amazon URL, an amzn.to / a.co short link, or a geni.us link — we resolve it
// to the ASIN and mint the link. Idempotent: the same product returns the same
// stable code.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultSite } from '@/lib/wordpress-sites'
import { getOrCreatePassportLink, passportLinkUrl, isSafePassportDestination } from '@/lib/passport-links'
import { asinFromAmazonUrl, resolveFinalUrl } from '@/lib/product-link'
import { extractAsin } from '@/services/amazon'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Pull an ASIN from a pasted product link. Handles a direct /dp/ URL, an ASIN
 *  sitting in the query/text, and short links (amzn.to / a.co / geni.us) that
 *  need one redirect hop to reveal the real Amazon URL. */
async function asinFromPastedUrl(raw: string): Promise<string | null> {
  const url = raw.trim()
  if (!url) return null
  const direct = asinFromAmazonUrl(url) || extractAsin(url)
  if (direct) return direct.toUpperCase()
  // Short / cloaked link → follow it once, then re-extract from the final URL.
  if (/(amzn\.to|a\.co|geni\.us|amzn\.eu|amzn\.asia|bit\.ly|tinyurl\.com|rebrand\.ly|lddy\.no|shrsl\.|go\.magik)/i.test(url)) {
    try {
      const final = await resolveFinalUrl(url)
      const a = asinFromAmazonUrl(final) || extractAsin(final)
      if (a) return a.toUpperCase()
    } catch { /* unreachable / blocked → no ASIN */ }
  }
  return null
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Studio + Pro only. The free SCOUT extension can reach this route, so the gate
  // is enforced here, not just in the UI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePassport(normalizeTier(tierRow?.tier))) {
    return NextResponse.json({ error: 'Passport Links is available on the Studio and Pro plans.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { asin?: string; url?: string; title?: string }
  const title = (body.title || '').trim() || null

  const site = await getDefaultSite(supabase, user.id)
  const siteId = site && site.id !== 'legacy' ? site.id : null
  const admin = createAdminClient()

  // Target: an explicit ASIN, else the pasted link. If the link resolves to an
  // Amazon product we geo-route it; ANY other link becomes a plain branded short
  // link (cloak + click tracking) pointing at the URL as pasted.
  let target: { asin?: string | null; destinationUrl?: string | null; label?: string | null }
  const explicitAsin = (body.asin || '').trim().toUpperCase()
  if (/^[A-Z0-9]{10}$/.test(explicitAsin)) {
    target = { asin: explicitAsin, label: title }
  } else {
    const raw = (body.url || '').trim()
    if (!raw) return NextResponse.json({ error: 'Paste a link (or provide an ASIN).' }, { status: 400 })
    if (!/^https?:\/\/\S+$/i.test(raw)) return NextResponse.json({ error: "That doesn't look like a link. Paste a full URL starting with http." }, { status: 400 })
    const asin = await asinFromPastedUrl(raw)
    if (!asin) {
      // Non-Amazon → a branded short link that 302s to this URL. Guardrail: only
      // point our domain at a real public web page (never internal hosts, our own
      // domains, or a userinfo phishing trick).
      if (!isSafePassportDestination(raw)) {
        return NextResponse.json({ error: 'That link can’t be used as a destination. Use a normal public product or store page (https).' }, { status: 400 })
      }
    }
    target = asin ? { asin, label: title } : { destinationUrl: raw, label: title }
  }

  const code = await getOrCreatePassportLink(admin, user.id, siteId, target)
  if (!code) return NextResponse.json({ error: 'Could not create the link. Passport Links storage may not be fully set up yet (run migrations 282 through 286).' }, { status: 500 })

  return NextResponse.json({ ok: true, url: passportLinkUrl(code), code, asin: target.asin ?? null, geo: !!target.asin })
}
