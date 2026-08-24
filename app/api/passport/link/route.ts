// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/passport/link  { asin, title? } → { ok, url }
//
// Get-or-create the caller's Passport Link (geo-routing short link) for a product,
// tied to their ACTIVE site so that site's country tags apply. Used by the card
// "Get link" buttons and (later) the blog/social builders. Idempotent: the same
// product returns the same stable code.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultSite } from '@/lib/wordpress-sites'
import { getOrCreatePassportLink, passportLinkUrl } from '@/lib/passport-links'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { asin?: string; title?: string }
  const asin = (body.asin || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) return NextResponse.json({ error: 'A valid ASIN is required.' }, { status: 400 })

  const site = await getDefaultSite(supabase, user.id)
  const siteId = site && site.id !== 'legacy' ? site.id : null

  const admin = createAdminClient()
  const code = await getOrCreatePassportLink(admin, user.id, siteId, asin, (body.title || '').trim() || null)
  if (!code) return NextResponse.json({ error: 'Could not create the link. Make sure Passport Links storage is set up (migration 282).' }, { status: 500 })

  return NextResponse.json({ ok: true, url: passportLinkUrl(code), code })
}
