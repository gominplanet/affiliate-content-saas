/**
 * POST /api/agency/accept
 * Body: { token: "agi_..." }
 *
 * Called from /agency/accept/[token] when an invitee is logged in (or just
 * signed up). We hash the token, look up the matching pending invite,
 * verify the caller's email matches the invite's email, then:
 *   1. Mark agency_invites.accepted_at
 *   2. Insert into agency_members (owner_user_id, member_user_id, role)
 *
 * Uses the admin client because RLS on agency_members.INSERT would
 * require auth.uid() = owner_user_id, but the INSERTING user is the
 * MEMBER. We enforce authorization manually via the token match.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashAgencyToken, INVITE_TTL_DAYS } from '@/lib/agency'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({
      error: 'You must sign up or sign in before accepting an invite',
      code: 'unauthenticated',
    }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const token = String(body.token || '').trim()
  if (!token || !token.startsWith('agi_')) {
    return NextResponse.json({ error: 'Invalid invite token' }, { status: 400 })
  }

  const admin = createAdminClient()
  const hash = hashAgencyToken(token)

  // Find the matching pending invite.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite } = await (admin as any)
    .from('agency_invites')
    .select('id, owner_user_id, email, role, created_at, accepted_at, declined_at')
    .eq('token_hash', hash)
    .maybeSingle()

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found', code: 'not_found' }, { status: 404 })
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: 'This invite has already been accepted', code: 'already_used' }, { status: 410 })
  }
  if (invite.declined_at) {
    return NextResponse.json({ error: 'This invite was declined', code: 'declined' }, { status: 410 })
  }
  // TTL — invites are dead after INVITE_TTL_DAYS regardless of accept state.
  const ageDays = (Date.now() - new Date(invite.created_at as string).getTime()) / 86400000
  if (ageDays > INVITE_TTL_DAYS) {
    return NextResponse.json({ error: 'This invite has expired', code: 'expired' }, { status: 410 })
  }

  // Email match — invitee must sign in with the email the invite was sent
  // to. Prevents someone with a leaked link from accepting on a random
  // account.
  const callerEmail = (user.email || '').toLowerCase()
  if (callerEmail !== (invite.email as string).toLowerCase()) {
    return NextResponse.json({
      error: `This invite was sent to ${invite.email}. Sign in with that email to accept.`,
      code: 'email_mismatch',
    }, { status: 403 })
  }

  // Reject if the caller is already a member of any agency (the unique
  // constraint on agency_members.member_user_id would also catch this,
  // but a clean error is friendlier).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from('agency_members')
    .select('id, owner_user_id, revoked_at')
    .eq('member_user_id', user.id)
    .maybeSingle()
  if (existing && !existing.revoked_at) {
    return NextResponse.json({
      error: 'You are already a member of another agency. Leave that one first.',
      code: 'already_member',
    }, { status: 409 })
  }

  // All checks passed — record acceptance + create the membership row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (admin as any)
    .from('agency_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await (admin as any)
    .from('agency_members')
    .insert({
      owner_user_id: invite.owner_user_id,
      member_user_id: user.id,
      role: invite.role,
    })

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    ownerUserId: invite.owner_user_id,
    role: invite.role,
  })
}
