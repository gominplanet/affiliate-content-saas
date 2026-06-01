/**
 * GET    /api/wordpress/sites          — list every WP site the user has connected
 * POST   /api/wordpress/sites          — add a new site (Pro-gated, max 5)
 *
 * Per-site PATCH (relabel / set default) + DELETE live at
 * /api/wordpress/sites/[id]/route.ts. Splitting them keeps each route file
 * narrow and the URL semantics RESTful.
 *
 * All routes scope by auth.uid() via RLS; we ALSO pass user.id explicitly so
 * the helpers can do tier-gating math without re-fetching the user.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  listSites,
  addSite,
  canAddSite,
} from '@/lib/wordpress-sites'
import { normalizeTier } from '@/lib/tier'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier + current cap usage so the UI can render "3 of 5 sites" and
  // gate the "+ Add another" button without a second round trip.
  const { data: integ } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .maybeSingle()
  const tier = normalizeTier(integ?.tier)
  const sites = await listSites(supabase, user.id)
  const cap = await canAddSite(supabase, user.id, tier)

  return NextResponse.json({
    sites,
    cap: {
      current: cap.current,
      max: cap.cap,
      canAddMore: cap.allowed,
    },
    tier,
  })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    label?: string
    url?: string
    username?: string
    appPassword?: string
    apiToken?: string
  }

  // Basic input validation. The DB CHECK trigger + RLS handle the rest.
  if (!body.url || !body.username || !body.appPassword) {
    return NextResponse.json(
      { error: 'url, username and appPassword are all required.' },
      { status: 400 },
    )
  }
  try {
    new URL(body.url)
  } catch {
    return NextResponse.json({ error: 'Please enter a full URL (https://your-site.com).' }, { status: 400 })
  }

  const { data: integ } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .maybeSingle()
  const tier = normalizeTier(integ?.tier)

  const result = await addSite(supabase, user.id, tier, {
    label: body.label || '',
    url: body.url,
    username: body.username,
    appPassword: body.appPassword,
    apiToken: body.apiToken || null,
  })
  if (!result.ok) {
    // 402 for "upgrade required" so the UI can detect tier-gated errors
    // separately from 400 input errors and surface an upgrade CTA.
    const status = result.error.toLowerCase().includes('pro') ? 402 : 400
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ ok: true, site: result.site })
}
