// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/social-link-modes  → { modes: { facebook, linkedin, bluesky } }
// POST /api/social-link-modes  { modes }  → saves the per-platform link mode
//
// The user's default for where a fanned-out post's link points, per platform.
// Read server-side by the facebook/linkedin/bluesky publish routes and the
// scheduled cron, so setting it here changes every future publish + schedule.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { parseLinkModes, LINK_MODE_PLATFORMS, type SocialLinkModes, type LinkMode } from '@/lib/social-link-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('integrations').select('social_link_modes').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ ok: true, modes: parseLinkModes(data?.social_link_modes) })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { modes?: unknown }
  // Sanitize down to the known platforms + valid modes before storing.
  const clean = parseLinkModes(body.modes)
  const modes: SocialLinkModes = {}
  for (const p of LINK_MODE_PLATFORMS) modes[p] = (clean[p] ?? 'blog') as LinkMode

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .update({ social_link_modes: modes })
    .eq('user_id', user.id)
  if (error) {
    const missingCol = /social_link_modes|column .* does not exist|schema cache/i.test(error.message || '')
    return NextResponse.json({
      error: missingCol
        ? 'The link-mode column is missing — run migration 210 in Supabase, then try again.'
        : (error.message || 'Could not save link settings.'),
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true, modes })
}
