/**
 * DELETE /api/agency/invites/[id]
 *
 * Cancel a pending invite. We hard-delete the row here (vs. soft-delete on
 * memberships) because invites carry the token hash; keeping a "cancelled"
 * row would also keep an active token that COULD theoretically be brute-
 * forced. Better to remove it entirely.
 *
 * Re-inviting the same email after cancellation: the previous row's
 * unique constraint (owner, email, declined_at) blocks a duplicate
 * pending invite — but after this DELETE the constraint is satisfied
 * again, so re-invite works immediately.
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
    .from('agency_invites')
    .delete()
    .eq('id', id)
    .eq('owner_user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
