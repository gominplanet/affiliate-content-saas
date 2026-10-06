// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/scout/seen  { version, install, background }
//
// What the dashboard found about SCOUT in this member's Chrome
// (components/layout/ScoutRequired.tsx): which version, from the Web Store or
// an old manual copy, and whether its background work is on. Kept on the
// member's integrations row (migration 414) so admin can see who has SCOUT
// and who does not. A database without that migration loses only this.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 15

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { version?: unknown; install?: unknown; background?: unknown }
  const version = typeof body.version === 'string' && /^\d{1,3}(\.\d{1,4}){1,3}$/.test(body.version) ? body.version : null
  const install = body.install === 'store' || body.install === 'sideload' || body.install === 'none' ? body.install : null
  if (!install) return NextResponse.json({ ok: false, error: 'What was found?' }, { status: 400 })
  const background = install === 'none' ? null : body.background === true ? true : body.background === false ? false : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAdminClient() as any).from('integrations')
    .update({ scout_version: version, scout_install: install, scout_background: background, scout_seen_at: new Date().toISOString() })
    .eq('user_id', user.id)
  // Said, not hidden: the banner works either way, but a missing column is
  // why the admin list would stay empty.
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
