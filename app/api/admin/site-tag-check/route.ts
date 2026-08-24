// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/site-tag-check   (admin only)
//
// Diagnoses per-site separation (migrations 222 + 280). For each connected site
// it shows the identity SNAPSHOT stored on that site's row — brand name, tagline,
// colors, logo, and Amazon tag — so you can see at a glance whether the two sites
// hold DIFFERENT data (separated) or the SAME data (still on the shared seed, or
// never given their own). Also shows the live brand_profiles + integrations tag,
// which always reflect the ACTIVE site.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The identity fields we surface from each site's brand_snapshot to prove
// separation (a small, readable subset — the snapshot holds the full brand row).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const identityOf = (snap: any) => {
  if (!snap || typeof snap !== 'object') return null
  return {
    name: snap.name ?? null,
    tagline: snap.tagline ?? null,
    primary_color: snap.primary_color ?? null,
    logo_url: snap.logo_url ?? null,
    author_name: snap.author_name ?? null,
    instagram_url: snap.instagram_url ?? null,
  }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier, amazon_associates_tag').eq('user_id', user.id).maybeSingle()
  if (normalizeTier((intRow as { tier?: string } | null)?.tier) !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const admin = createAdminClient()
  const integrationsTag = (intRow as { amazon_associates_tag?: string | null } | null)?.amazon_associates_tag ?? null

  // The live active-site identity (what the app currently reads).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: liveBrand } = await (admin as any)
    .from('brand_profiles').select('name, tagline, primary_color, logo_url, author_name, instagram_url').eq('user_id', user.id).maybeSingle()

  // Try the full per-site select (needs 280 for the tag + 222 for brand_snapshot).
  let columnExists = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: sites, error } = await (admin as any)
    .from('wordpress_sites')
    .select('id, label, url, is_default, amazon_associates_tag, brand_snapshot')
    .eq('user_id', user.id)
    .order('display_order', { ascending: true })
  if (error) {
    columnExists = !/amazon_associates_tag/.test(error.message || '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retry = await (admin as any)
      .from('wordpress_sites').select('id, label, url, is_default, brand_snapshot')
      .eq('user_id', user.id).order('display_order', { ascending: true })
    sites = retry.data
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (sites ?? []).map((s: any) => ({
    id: s.id,
    label: s.label,
    url: s.url,
    isDefault: !!s.is_default,
    perSiteTag: 'amazon_associates_tag' in s ? (s.amazon_associates_tag ?? null) : '(column missing)',
    hasOwnSnapshot: !!(s.brand_snapshot && typeof s.brand_snapshot === 'object' && Object.keys(s.brand_snapshot).length > 0),
    storedIdentity: identityOf(s.brand_snapshot),
  }))

  // Are the two sites actually distinct on brand name / tag? (Quick separation read.)
  const tags = new Set(rows.map((r: { perSiteTag: unknown }) => JSON.stringify(r.perSiteTag)))
  const names = new Set(rows.map((r: { storedIdentity: { name?: unknown } | null }) => JSON.stringify(r.storedIdentity?.name ?? null)))

  return NextResponse.json({
    ok: true,
    migration280Applied: columnExists,
    integrationsTag,
    liveActiveBrand: liveBrand ?? null,
    siteCount: rows.length,
    sites: rows,
    separation: {
      tagsDistinct: tags.size === rows.length && rows.length > 1,
      brandNamesDistinct: names.size === rows.length && rows.length > 1,
    },
    hint: !columnExists
      ? 'Run migration 280 — per-site tags cannot work until wordpress_sites.amazon_associates_tag exists.'
      : 'Each site stores its own identity in storedIdentity + perSiteTag. If two sites show the SAME values, they were seeded identically or never given their own — set + save distinct values on each site (switch first). hasOwnSnapshot:false means that site has never been saved on its own yet.',
  })
}
