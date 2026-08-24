// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET/POST /api/passport — Passport Links settings.
//   GET  → { enabled, usTag, countryTags, linkBase }
//   POST → { enabled?, countryTags? }  saves the on/off flag (account) + the
//          per-country tag map (the ACTIVE site's row, or the account for a
//          single-site creator). The US tag itself is the existing Associates tag,
//          managed on the affiliate settings; this handles the OTHER countries.
//
// Country tags live on wordpress_sites.amazon_country_tags per site (each brand can
// have its own), with integrations.amazon_country_tags as the single-site fallback.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getDefaultSite } from '@/lib/wordpress-sites'
import { passportLinkBase, AMAZON_MARKETPLACES } from '@/lib/passport-links'

export const dynamic = 'force-dynamic'

// Clean a submitted country-tag map: uppercase alpha-2 keys we actually route to,
// trimmed non-empty string values, US dropped (that's the main Associates tag).
function cleanCountryTags(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const cc = String(k || '').trim().toUpperCase()
    const tag = String(v ?? '').trim().slice(0, 80)
    if (cc !== 'US' && AMAZON_MARKETPLACES[cc] && tag) out[cc] = tag
  }
  return out
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (supabase as any)
    .from('integrations').select('amazon_associates_tag, passport_links_enabled, amazon_country_tags').eq('user_id', user.id).maybeSingle()

  const site = await getDefaultSite(supabase, user.id)
  let countryTags: Record<string, string> = (ig?.amazon_country_tags as Record<string, string> | null) ?? {}
  if (site && site.id !== 'legacy') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: s } = await (supabase as any)
      .from('wordpress_sites').select('amazon_country_tags').eq('id', site.id).maybeSingle()
    if (s?.amazon_country_tags && Object.keys(s.amazon_country_tags).length) countryTags = s.amazon_country_tags
  }

  return NextResponse.json({
    ok: true,
    enabled: !!ig?.passport_links_enabled,
    usTag: (ig?.amazon_associates_tag as string | null) ?? '',
    countryTags,
    linkBase: passportLinkBase(),
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { enabled?: boolean; countryTags?: unknown }

  // Enable flag → account (integrations).
  if (typeof body.enabled === 'boolean') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert({ user_id: user.id, passport_links_enabled: body.enabled }, { onConflict: 'user_id' })
  }

  // Country tags → the active site if there is one, else the account.
  if (body.countryTags !== undefined) {
    const tags = cleanCountryTags(body.countryTags)
    const site = await getDefaultSite(supabase, user.id)
    if (site && site.id !== 'legacy') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('wordpress_sites').update({ amazon_country_tags: tags }).eq('user_id', user.id).eq('id', site.id)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('integrations').upsert({ user_id: user.id, amazon_country_tags: tags }, { onConflict: 'user_id' })
    }
  }

  return NextResponse.json({ ok: true })
}
