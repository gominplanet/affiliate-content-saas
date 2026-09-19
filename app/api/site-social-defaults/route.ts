// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Read and set per-site social routing (migration 346).
//
// GET returns the creator's sites, their connected accounts per platform, and
// the mappings between them, in one call. One call because the screen cannot
// render anything useful with a subset: a list of sites with no accounts to
// choose from is a dropdown with nothing in it, and mappings with no names
// beside them are uuids.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listSocialAccounts, type SocialPlatform } from '@/lib/social-accounts'
import { listSiteSocialDefaults, setSiteSocialDefault } from '@/lib/site-social-defaults'
import { listSites } from '@/lib/wordpress-sites'

/** The platforms this screen routes. Matches what resolveSocialAccount knows. */
const PLATFORMS: SocialPlatform[] = ['facebook', 'instagram', 'threads']

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // listSites, not a select of our own. The columns are `label` and `url`, and
  // naming them wrong would make PostgREST reject the entire read and report it
  // as "no sites", which is the same class of bug that made every platform read
  // as disconnected on the Quick Post modal. Reusing the helper means there is
  // one spelling of this query in the codebase, and it is already correct.
  const sites = (await listSites(supabase, user.id)).map((s) => ({
    id: s.id,
    label: s.label,
    url: s.url,
    isDefault: s.isDefault,
  }))

  const accounts = await listSocialAccounts(supabase, user.id)
  const defaults = await listSiteSocialDefaults(supabase, user.id)

  return NextResponse.json({
    ok: true,
    sites,
    accounts: accounts.filter((a) => PLATFORMS.includes(a.platform)),
    defaults,
    platforms: PLATFORMS,
    // The screen only earns its place on an account with more than one blog.
    // Said here rather than counted in the component, so the rule lives with
    // the data it is about.
    routingApplies: sites.length > 1,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { siteId?: string; platform?: string; socialAccountId?: string | null }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const siteId = (body.siteId || '').trim()
  const platform = (body.platform || '').trim()
  if (!siteId || !platform) {
    return NextResponse.json({ error: 'siteId and platform are required' }, { status: 400 })
  }
  if (!(PLATFORMS as string[]).includes(platform)) {
    return NextResponse.json({ error: `platform must be one of ${PLATFORMS.join(', ')}` }, { status: 400 })
  }

  // An empty string from a <select> means "no routing", same as null. Both map
  // to a delete, so the absence of a mapping has one representation.
  const accountId = body.socialAccountId ? String(body.socialAccountId) : null

  const result = await setSiteSocialDefault(supabase, user.id, siteId, platform, accountId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
