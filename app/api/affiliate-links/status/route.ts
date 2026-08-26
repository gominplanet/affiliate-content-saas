// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/affiliate-links/status — a tiny, secret-free check the dashboard uses
// to warn a creator who is generating Amazon affiliate content with NO Amazon
// Associates tag set (so their Amazon links earn nothing, whatever Link style
// they picked — even Passport routes to a store under this tag).
//
// "Effective tag" mirrors how generation resolves it: the ACTIVE site's tag wins,
// falling back to the account tag. Returns only booleans, never the tag itself.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultSite } from '@/lib/wordpress-sites'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ig } = await (admin as any)
      .from('integrations').select('amazon_associates_tag').eq('user_id', user.id).maybeSingle()
    let tag = String(ig?.amazon_associates_tag ?? '').trim()

    // The active site's own tag wins when set (per-site Associates tags, migration
    // 280). Best-effort: a DB without that column just keeps the account tag.
    try {
      const site = await getDefaultSite(supabase, user.id)
      if (site && site.id !== 'legacy') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: s } = await (admin as any)
          .from('wordpress_sites').select('amazon_associates_tag').eq('id', site.id).maybeSingle()
        const siteTag = String(s?.amazon_associates_tag ?? '').trim()
        if (siteTag) tag = siteTag
      }
    } catch { /* keep the account tag */ }

    return NextResponse.json({ ok: true, hasAmazonTag: !!tag })
  } catch {
    // Fail open — never let this check block or nag on an error.
    return NextResponse.json({ ok: false, hasAmazonTag: true })
  }
}
