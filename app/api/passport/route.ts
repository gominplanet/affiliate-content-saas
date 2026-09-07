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
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultSite } from '@/lib/wordpress-sites'
import { passportLinkBase, AMAZON_MARKETPLACES } from '@/lib/passport-links'
import { canUsePassport } from '@/lib/feature-access'
import { normalizeTier } from '@/lib/tier'
import { getOwnerUserId } from '@/lib/agency'

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

  // The passport flag + tier live on the OWNER's row (generation reads the owner
  // via getLinkStyle), so a VA must read the owner too — else the UI shows a
  // different state than the generator uses. Admin client crosses the RLS boundary.
  const ownerId = await getOwnerUserId(user.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ig } = await (createAdminClient() as any)
    .from('integrations').select('amazon_associates_tag, passport_links_enabled, amazon_country_tags, tier').eq('user_id', ownerId).maybeSingle()

  const canUse = canUsePassport(normalizeTier(ig?.tier))

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
    canUse,
    enabled: !!ig?.passport_links_enabled && canUse,
    usTag: (ig?.amazon_associates_tag as string | null) ?? '',
    countryTags,
    linkBase: passportLinkBase(),
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read tier + write the flag on the OWNER's row (matches getLinkStyle + the
  // Geniuslink test), so a VA toggling Passport actually changes what generation
  // sees. Admin client crosses RLS for the owner row.
  const ownerId = await getOwnerUserId(user.id)
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (admin as any).from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
  if (!canUsePassport(normalizeTier(tierRow?.tier))) {
    return NextResponse.json({ error: 'Passport Links is available on the Amazon, Studio, and Pro plans.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { enabled?: boolean; countryTags?: unknown }

  // Enable flag → the OWNER's account row.
  //
  // WRITTEN, THEN READ BACK. This flag decides what every affiliate link in a
  // creator's content becomes, and until now the route awaited the write
  // without looking at it and returned ok:true regardless. A write that never
  // landed (a missing unique index on user_id makes an onConflict upsert throw,
  // among other things) produced a toggle that switched on, said it saved, and
  // left the database on false. From the outside that is indistinguishable from
  // never having touched it, which is exactly the position we were just in.
  //
  // So the answer comes from the row, not from the absence of an exception.
  if (typeof body.enabled === 'boolean') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (admin as any).from('integrations')
      .upsert({ user_id: ownerId, passport_links_enabled: body.enabled }, { onConflict: 'user_id' })
    if (upErr) {
      console.error('[passport] enable write failed:', upErr.message)
      return NextResponse.json({ error: `Could not save the Passport setting: ${upErr.message}` }, { status: 500 })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: after } = await (admin as any).from('integrations')
      .select('passport_links_enabled').eq('user_id', ownerId).maybeSingle()
    if (!after || after.passport_links_enabled !== body.enabled) {
      console.error(`[passport] enable did not persist: wanted ${body.enabled}, row says ${after ? after.passport_links_enabled : 'no row'}`)
      return NextResponse.json({
        error: 'The Passport setting did not save. Nothing was changed, so your links are still being built the old way.',
      }, { status: 500 })
    }
  }

  // Country tags → the active site if there is one, else the account.
  if (body.countryTags !== undefined) {
    const tags = cleanCountryTags(body.countryTags)
    const site = await getDefaultSite(supabase, user.id)
    // Same rule as above: a save that cannot fail out loud is a save you cannot
    // trust, and country tags decide which storefront a click lands on.
    const { error: tagErr } = site && site.id !== 'legacy'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (supabase as any).from('wordpress_sites').update({ amazon_country_tags: tags }).eq('user_id', user.id).eq('id', site.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : await (supabase as any).from('integrations').upsert({ user_id: user.id, amazon_country_tags: tags }, { onConflict: 'user_id' })
    if (tagErr) {
      console.error('[passport] country tags write failed:', tagErr.message)
      return NextResponse.json({ error: `Could not save your country tags: ${tagErr.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
