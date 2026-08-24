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
import { getOrCreatePassportLink, passportLinkUrl } from '@/lib/passport-links'
import { asinFromAmazonUrl, resolveFinalUrl } from '@/lib/product-link'
import { extractAsin } from '@/services/amazon'

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

  const body = await request.json().catch(() => ({})) as { asin?: string; url?: string; title?: string }

  // Resolve to an ASIN: an explicit one wins, else pull it from the pasted link.
  let asin = (body.asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    if (body.url && body.url.trim()) {
      const resolved = await asinFromPastedUrl(body.url)
      if (!resolved) {
        return NextResponse.json({ error: "Couldn't find an Amazon product in that link. Paste an Amazon product URL (or an amzn.to / geni.us link)." }, { status: 400 })
      }
      asin = resolved
    } else {
      return NextResponse.json({ error: 'Paste an Amazon product link (or provide an ASIN).' }, { status: 400 })
    }
  }

  const site = await getDefaultSite(supabase, user.id)
  const siteId = site && site.id !== 'legacy' ? site.id : null

  const admin = createAdminClient()
  const code = await getOrCreatePassportLink(admin, user.id, siteId, asin, (body.title || '').trim() || null)
  if (!code) return NextResponse.json({ error: 'Could not create the link. Make sure Passport Links storage is set up (migration 282).' }, { status: 500 })

  return NextResponse.json({ ok: true, url: passportLinkUrl(code), code, asin })
}
