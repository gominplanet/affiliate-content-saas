// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/social-link-modes  → { prefs: { facebook, linkedin, bluesky } }
// POST /api/social-link-modes  { prefs }  → saves the per-platform link prefs
//
// Each pref is { product: boolean, content: 'blog'|'video'|'none' }. Read
// server-side by the facebook/linkedin/bluesky publish routes and the cron.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { parseLinkPrefs, linkPrefFor, LINK_MODE_PLATFORMS, type SocialLinkPrefs } from '@/lib/social-link-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).from('integrations').select('social_link_modes').eq('user_id', user.id).maybeSingle()
  const parsed = parseLinkPrefs(data?.social_link_modes)
  // Return a fully-populated object (every platform has a pref) so the UI is simple.
  const prefs: SocialLinkPrefs = {}
  for (const p of LINK_MODE_PLATFORMS) prefs[p] = linkPrefFor(parsed, p)
  return NextResponse.json({ ok: true, prefs })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { prefs?: unknown }
  const clean = parseLinkPrefs(body.prefs)
  const prefs: SocialLinkPrefs = {}
  for (const p of LINK_MODE_PLATFORMS) prefs[p] = linkPrefFor(clean, p)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .update({ social_link_modes: prefs })
    .eq('user_id', user.id)
  if (error) {
    const missingCol = /social_link_modes|column .* does not exist|schema cache/i.test(error.message || '')
    return NextResponse.json({
      error: missingCol
        ? 'The link-settings column is missing — run migration 210 in Supabase, then try again.'
        : (error.message || 'Could not save link settings.'),
    }, { status: 500 })
  }
  return NextResponse.json({ ok: true, prefs })
}
