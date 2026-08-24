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

import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPassportDestination, parseUserAgent, normalizeCountry } from '@/lib/passport-links'

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
      .from('passport_links').select('asin, destination_url, user_id, site_id, source').eq('code', code).maybeSingle()
    if (!link || (!link.asin && !link.destination_url)) return NextResponse.redirect(AMAZON_HOME, 302)

    // Source: the one baked into the link (new clean codes carry it on the row),
    // else a legacy ?s= param, else the referring host.
    const url = new URL(req.url)
    const storedSource = (link.source as string | null) || null
    const sParam = storedSource || (url.searchParams.get('s') || '').slice(0, 40)
    let source = sParam || null
    if (!source) {
      const ref = req.headers.get('referer') || ''
      try { source = ref ? new URL(ref).host.slice(0, 80) : null } catch { source = null }
    }

    const visitorCountry = req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || 'US'
    // Device / browser / OS from the UA, for the dashboard breakdowns.
    const ua = parseUserAgent(req.headers.get('user-agent'))

    // Two kinds of link. An Amazon ASIN is geo-routed to the visitor's local store
    // + the creator's tag there; any other link is forwarded to its destination
    // as-is (a branded short link). Both log a click.
    let finalUrl: string
    let logCountry: string
    let marketplace: string | null

    if (link.asin) {
      // The creator's tags: per-site country map + default (US) tag. Fall back to
      // the account-wide integrations tag when the link isn't tied to a site.
      // The site and account reads are independent — run them together so a
      // site-tied click pays one round trip for both, not two.
      const [siteRes, igRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        link.site_id
          ? (admin as any).from('wordpress_sites').select('amazon_associates_tag, amazon_country_tags').eq('id', link.site_id).maybeSingle()
          : Promise.resolve({ data: null }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin as any).from('integrations').select('amazon_associates_tag, amazon_country_tags').eq('user_id', link.user_id).maybeSingle(),
      ])
      const site = siteRes?.data
      const ig = igRes?.data
      let defaultTag: string | null = (site?.amazon_associates_tag as string | null) ?? null
      const siteTags: Record<string, string> = (site?.amazon_country_tags as Record<string, string> | null) ?? {}
      if (!defaultTag) defaultTag = (ig?.amazon_associates_tag as string | null) ?? null
      // REPLACE, not merge: if the link's site has its own country tags, use ONLY
      // those (each brand is fully separate). Otherwise fall back to the account
      // map. This matches exactly what the settings screen shows, so a creator can
      // never earn on an account-level tag the UI is hiding. (2026-08 audit)
      const accountTags = (ig?.amazon_country_tags as Record<string, string> | null) ?? {}
      const countryTags: Record<string, string> = Object.keys(siteTags).length ? siteTags : accountTags

      const dest = buildPassportDestination(String(link.asin), visitorCountry, countryTags, defaultTag)
      finalUrl = dest.url
      logCountry = dest.country
      marketplace = dest.marketplace
      // Carry the explicit source to Amazon as ascsubtag so per-source (e.g. per
      // video) earnings attribution survives the geo-redirect. Amazon caps it at
      // 16 URL-safe chars; a referer-host source isn't ours to tag, so it's blank.
      const asc = sParam.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16)
      if (asc) finalUrl += `${finalUrl.includes('?') ? '&' : '?'}ascsubtag=${asc}`
    } else {
      // Plain destination link (any non-Amazon URL) — forward as pasted.
      finalUrl = String(link.destination_url)
      logCountry = normalizeCountry(visitorCountry)
      marketplace = null
    }

    // Log the click AFTER the response is sent (after()/waitUntil), so the visitor
    // is redirected without waiting on the insert's round trip. Best-effort — a
    // logging failure never affects the redirect.
    const userId = link.user_id as string
    after(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from('passport_link_clicks').insert({
          code, user_id: userId, country: logCountry, marketplace, source,
          device: ua.device, browser: ua.browser, os: ua.os,
        })
      } catch { /* never let logging block anything */ }
    })

    return NextResponse.redirect(finalUrl, 302)
  } catch {
    return NextResponse.redirect(AMAZON_HOME, 302)
  }
}
