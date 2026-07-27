/**
 * Weekly Deal Digest opt-in.
 *   GET  → { enabled: boolean }
 *   POST { enabled } → toggle integrations.notification_preferences.weekly_digest
 *
 * Read-modify-write the JSONB prefs so we only touch the one key.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations').select('notification_preferences').eq('user_id', user.id).maybeSingle()
  const prefs = (data?.notification_preferences || {}) as Record<string, unknown>
  return NextResponse.json({ ok: true, enabled: prefs.weekly_digest === true })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { enabled?: boolean }
  const enabled = body.enabled === true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb.from('integrations').select('notification_preferences').eq('user_id', user.id).maybeSingle()
  const prefs = { ...((data?.notification_preferences || {}) as Record<string, unknown>), weekly_digest: enabled }
  const { error } = await sb.from('integrations').update({ notification_preferences: prefs }).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, enabled })
}
