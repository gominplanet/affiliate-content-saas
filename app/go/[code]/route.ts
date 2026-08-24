// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /go/[code] — the Passport Links redirect (migration 282).
//
// Public, no session. Resolves a short code to its product, reads the visitor's
// country (Vercel hands us x-vercel-ip-country on every request), sends them to
// THEIR country's Amazon store with the creator's tag there (US tag as fallback),
// logs the click for the analytics dashboard, and 302s. Kept lean so it's fast:
// two small indexed reads + one insert, then redirect.
//
// The short branded domain (e.g. mvpl.ink/x7k) is pointed at the app and rewritten
// to this route; until it's registered the links live on the app origin /go/…, and
// the same codes keep working when the domain is swapped in (PASSPORT_LINK_BASE).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPassportDestination } from '@/lib/passport-links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AMAZON_HOME = 'https://www.amazon.com'

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code: raw } = await ctx.params
  const code = (raw || '').trim()
  // Codes are short base62; anything else can't be ours.
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return NextResponse.redirect(AMAZON_HOME, 302)

  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: link } = await (admin as any)
      .from('passport_links').select('asin, user_id, site_id').eq('code', code).maybeSingle()
    if (!link?.asin) return NextResponse.redirect(AMAZON_HOME, 302)

    // The creator's tags: per-site country map + default (US) tag. Fall back to the
    // account-wide integrations tag when the link isn't tied to a specific site.
    let defaultTag: string | null = null
    let countryTags: Record<string, string> = {}
    if (link.site_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: site } = await (admin as any)
        .from('wordpress_sites').select('amazon_associates_tag, amazon_country_tags').eq('id', link.site_id).maybeSingle()
      defaultTag = (site?.amazon_associates_tag as string | null) ?? null
      countryTags = (site?.amazon_country_tags as Record<string, string> | null) ?? {}
    }
    if (!defaultTag) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ig } = await (admin as any)
        .from('integrations').select('amazon_associates_tag').eq('user_id', link.user_id).maybeSingle()
      defaultTag = (ig?.amazon_associates_tag as string | null) ?? null
    }

    const country = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || 'US'
    const dest = buildPassportDestination(String(link.asin), country, countryTags, defaultTag)

    // Log the click (awaited — small insert, keeps the dashboard reliable). Source:
    // an explicit ?s= we add when building links, else the referring host.
    const url = new URL(req.url)
    let source = (url.searchParams.get('s') || '').slice(0, 40) || null
    if (!source) {
      const ref = req.headers.get('referer') || ''
      try { source = ref ? new URL(ref).host.slice(0, 80) : null } catch { source = null }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('passport_link_clicks').insert({
        code, user_id: link.user_id, country: dest.country, marketplace: dest.marketplace, source,
      })
    } catch { /* never let logging block the redirect */ }

    return NextResponse.redirect(dest.url, 302)
  } catch {
    return NextResponse.redirect(AMAZON_HOME, 302)
  }
}
