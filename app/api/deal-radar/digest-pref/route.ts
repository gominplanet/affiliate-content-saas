/**
 * Weekly Deal Digest opt-in.
 *   GET  → { enabled: boolean }
 *   POST { enabled } → toggle integrations.notification_preferences.weekly_digest
 *
 * Read-modify-write the JSONB prefs so we only touch the one key. The write goes
 * through the service-role client (after authenticating the user) so it always
 * persists regardless of any row-level UPDATE policy gap — otherwise the toggle
 * "doesn't stay on": the POST returns OK but the row never changes.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data } = await admin
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
  const admin = createAdminClient() as any
  const { data: row } = await admin
    .from('integrations').select('notification_preferences').eq('user_id', user.id).maybeSingle()
  const prefs = { ...((row?.notification_preferences || {}) as Record<string, unknown>), weekly_digest: enabled }

  const { data: updated, error } = await admin
    .from('integrations').update({ notification_preferences: prefs })
    .eq('user_id', user.id).select('notification_preferences').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'No settings row to update — reconnect your account.' }, { status: 404 })

  const saved = ((updated.notification_preferences || {}) as Record<string, unknown>).weekly_digest === true
  return NextResponse.json({ ok: true, enabled: saved })
}
