// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/site-tag-check   (admin only)
//
// Diagnoses the per-site Amazon Associates tag (migration 280). Reports:
//   - whether wordpress_sites.amazon_associates_tag exists yet (280 applied?)
//   - the single account-wide integrations.amazon_associates_tag (the live value
//     every link reads, = the ACTIVE site's tag)
//   - each connected site with its own stored tag + which is the active/default
//
// If columnExists is false, per-site tags can't work yet and every site shows the
// same value — run 280. If it's true but two sites share a tag, they simply
// haven't been given different ones (a site with none inherits the current tag).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  // Try the per-site column. If 280 hasn't run, this errors (column missing) and
  // we re-query without it so the rest of the readout still works.
  let columnExists = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: sites, error } = await (admin as any)
    .from('wordpress_sites')
    .select('id, label, url, is_default, amazon_associates_tag')
    .eq('user_id', user.id)
    .order('display_order', { ascending: true })
  if (error) {
    columnExists = !/amazon_associates_tag/.test(error.message || '')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const retry = await (admin as any)
      .from('wordpress_sites')
      .select('id, label, url, is_default')
      .eq('user_id', user.id)
      .order('display_order', { ascending: true })
    sites = retry.data
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (sites ?? []).map((s: any) => ({
    id: s.id,
    label: s.label,
    url: s.url,
    isDefault: !!s.is_default,
    perSiteTag: 'amazon_associates_tag' in s ? (s.amazon_associates_tag ?? null) : '(column missing)',
  }))

  return NextResponse.json({
    ok: true,
    migration280Applied: columnExists,
    integrationsTag,
    siteCount: rows.length,
    sites: rows,
    hint: !columnExists
      ? 'Run migration 280 (wordpress_sites.amazon_associates_tag). Until then all sites share integrationsTag.'
      : 'Per-site column exists. Each site with its own perSiteTag uses it; a site showing null inherits integrationsTag until you set one on that site.',
  })
}
