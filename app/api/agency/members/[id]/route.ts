/**
 * DELETE /api/agency/members/[id]
 *
 * Revoke an active agency seat. SOFT delete (set revoked_at) so the audit
 * trail survives — same pattern as api_keys. The member can still log in
 * to their own auth row but immediately loses access to the parent's
 * data (in Phase 2 — for now this is a no-op since members don't yet
 * inherit access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizePermissions } from '@/lib/agency'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('agency_members')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** PATCH /api/agency/members/[id]
 *  Body: { permissions: VaPermissions }
 *
 *  Owners can adjust a VA's permission set at any time after the VA has
 *  accepted the invite. We re-normalize the input (missing keys default
 *  to false) so a partial PATCH doesn't accidentally grant permissions
 *  the caller didn't explicitly set.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let body: { permissions?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  if (body.permissions === undefined) {
    return NextResponse.json({ error: 'permissions field required' }, { status: 400 })
  }
  const permissions = normalizePermissions(body.permissions)

  // Scope to owner_user_id — owners can only PATCH their own VAs. RLS
  // enforces it server-side too, but we filter here so a wrong id
  // returns 0 rows rather than a misleading success.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('agency_members')
    .update({ permissions })
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .is('revoked_at', null)
    .select('id, permissions')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return NextResponse.json({ ok: true, permissions: data.permissions })
}
