// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/social-launch-kit/saved — returns this user's persisted Launch Kits
// (one saved slot per platform: the copy + the durable banner/avatar URLs). The
// page hydrates from this on load so a previously-generated kit stays on screen,
// ready to use whenever the user is. RLS scopes rows to the caller.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('social_launch_kits')
    .select('platform,kit,banner_url,avatar_url')
    .eq('user_id', user.id)

  const saved: Record<string, { kit?: unknown; bannerUrl?: string; avatarUrl?: string }> = {}
  for (const r of (data ?? []) as { platform: string; kit: unknown; banner_url: string | null; avatar_url: string | null }[]) {
    saved[r.platform] = {
      kit: r.kit ?? undefined,
      bannerUrl: r.banner_url ?? undefined,
      avatarUrl: r.avatar_url ?? undefined,
    }
  }
  return NextResponse.json({ ok: true, saved })
}
