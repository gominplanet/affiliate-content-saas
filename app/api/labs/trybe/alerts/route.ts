// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /api/labs/trybe/alerts — the TRYBE reply alert (lib/trybe-alerts.ts).
//
// GET   { unread, names, checkedAt }   for the menu count. `unread` is null
//                                      when no current count is known.
// POST  { unread, names }              what SCOUT just read from the inbox.
//
// Needs migration 420 (inbox_unread, inbox_unread_names, inbox_checked_at on
// trybe_outreach_settings). Before it, GET says so instead of a zero.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { canUsePreview } from '@/lib/labs-preview'
import { freshUnread } from '@/lib/trybe-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function gate() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if ('error' in auth && auth.error) return { error: auth.error }
  const { user, ownerId } = auth as { user: { id: string }; ownerId: string }
  const admin = createAdminClient() as Db
  const { data: intg } = await admin.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('trybe_outreach', intg?.tier)) return { error: NextResponse.json({ error: 'TRYBE Outreach is part of the Pro plan.' }, { status: 403 }) }
  return { admin, ownerId }
}

const missing = (m: string) => /column .* does not exist|schema cache/i.test(m)

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const { data, error } = await g.admin.from('trybe_outreach_settings').select('inbox_unread, inbox_unread_names, inbox_checked_at').eq('user_id', g.ownerId).maybeSingle()
  if (error) return NextResponse.json({ unread: null, names: [], checkedAt: null, error: missing(error.message) ? 'TRYBE reply alerts need migration 420 in Supabase first.' : error.message }, { status: missing(error.message) ? 200 : 500 })
  const checkedAt = (data?.inbox_checked_at as string | null) ?? null
  const unread = freshUnread({ unread: data?.inbox_unread ?? null, checkedAt })
  return NextResponse.json({ unread, names: unread ? (data?.inbox_unread_names || []) : [], checkedAt })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const n = Number(body.unread)
  if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'unread must be a number' }, { status: 400 })
  const names = (Array.isArray(body.names) ? body.names : []).filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 80)).slice(0, 10)
  const now = new Date().toISOString()
  const { error } = await g.admin.from('trybe_outreach_settings').upsert({
    user_id: g.ownerId, inbox_unread: Math.min(9999, Math.round(n)), inbox_unread_names: names, inbox_checked_at: now,
  }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: missing(error.message) ? 'TRYBE reply alerts need migration 420 in Supabase first.' : error.message }, { status: 500 })
  return NextResponse.json({ ok: true, checkedAt: now })
}
