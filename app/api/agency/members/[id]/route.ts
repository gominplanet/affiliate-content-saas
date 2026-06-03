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
