// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/wordpress/active-site   { siteId }
//
// Switch the user's ACTIVE WordPress site (the topbar blog switcher). This does
// two things so the WHOLE app follows, not just the routes that read the new
// wordpress_sites table:
//   1. Marks the chosen site as the default in wordpress_sites.
//   2. Mirrors that site's credentials into the LEGACY integrations.wordpress_*
//      columns, which the topbar chip and every not-yet-migrated route still
//      read (the multi-site migration is mid-flight). Without this, switching
//      would update the picker but leave the rest of the app on the old blog.
//
// The raw (still-encrypted) values are copied verbatim, so encryption format is
// preserved. Owner-scoped via getAuthAndOwner + RLS.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { setDefaultSite } from '@/lib/wordpress-sites'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { siteId } = await req.json().catch(() => ({})) as { siteId?: string }
  if (!siteId || typeof siteId !== 'string') {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }

  // Read the target site's RAW columns (do NOT decrypt — we copy the stored
  // values verbatim so the legacy columns keep the same encryption format).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: site, error: siteErr } = await (supabase as any)
    .from('wordpress_sites')
    .select('id, url, username, app_password, api_token, content_only, cta_style')
    .eq('user_id', ownerId)
    .eq('id', siteId)
    .maybeSingle()
  if (siteErr) return NextResponse.json({ error: siteErr.message }, { status: 500 })
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // 1) Make it the default in the new table.
  const def = await setDefaultSite(supabase, ownerId, siteId)
  if (!def.ok) return NextResponse.json({ error: def.error }, { status: 400 })

  // 2) Mirror into the legacy integrations columns so the topbar + every
  //    not-yet-migrated route targets this blog too.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: intErr } = await (supabase as any)
    .from('integrations')
    .update({
      wordpress_url: site.url,
      wordpress_username: site.username,
      wordpress_app_password: site.app_password,
      wordpress_api_token: site.api_token,
      content_only: site.content_only ?? false,
      cta_style: site.cta_style === 'link' ? 'link' : 'button',
    })
    .eq('user_id', ownerId)
  if (intErr) return NextResponse.json({ error: intErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, url: site.url })
}
