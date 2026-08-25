// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/social-launch-kit/saved — returns this user's persisted Launch Kits
// (one saved slot per platform: the copy + the durable banner/avatar URLs). The
// page hydrates from this on load so a previously-generated kit stays on screen,
// ready to use whenever the user is. RLS scopes rows to the caller.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getDefaultSite } from '@/lib/wordpress-sites'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admins can regenerate freely; everyone else gets one generation per slot,
  // so the page hides the regenerate control once a slot is filled.
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const isAdmin = intRow?.tier === 'admin'

  // Kits are per-site (per-profile) — only load the ACTIVE site's kits so the page
  // reflects the profile the creator is currently on. Legacy (no sites) → null.
  const site = await getDefaultSite(supabase, user.id)
  const siteId = site && site.id !== 'legacy' ? (site.id as string) : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('social_launch_kits')
    .select('platform,kit,banner_url,avatar_url')
    .eq('user_id', user.id)
  query = siteId ? query.eq('site_id', siteId) : query.is('site_id', null)
  const { data } = await query

  const saved: Record<string, { kit?: unknown; bannerUrl?: string; avatarUrl?: string }> = {}
  for (const r of (data ?? []) as { platform: string; kit: unknown; banner_url: string | null; avatar_url: string | null }[]) {
    saved[r.platform] = {
      kit: r.kit ?? undefined,
      bannerUrl: r.banner_url ?? undefined,
      avatarUrl: r.avatar_url ?? undefined,
    }
  }
  return NextResponse.json({ ok: true, saved, isAdmin })
}
