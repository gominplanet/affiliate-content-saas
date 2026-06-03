/**
 * DELETE /api/api-keys/[id]
 *
 * Revoke an API key. We do NOT hard-delete the row — setting revoked_at
 * preserves the audit trail (the user can see "this key was active for X
 * days then revoked on Y"). The auth middleware filters on `revoked_at IS
 * NULL` so a revoked key can no longer authenticate, but the metadata
 * stays around for forensics if a leak is suspected.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  // RLS allows update only when auth.uid() = user_id, so an attacker who
  // guesses someone else's key id still can't revoke it. Belt-and-suspenders.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
