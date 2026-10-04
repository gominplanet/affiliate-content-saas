// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// PUBLISH AS THE OWNER. A Virtual Assistant schedules and publishes through
// the OWNER's connected socials, the way Later works: the owner connects each
// account once, gives the VA "Publish to socials", and the VA never logs into
// any of them.
//
// Every posting and scheduling route starts with getPublishContext instead of
// auth.getUser. It hands back:
//   user      the account the work is for (the owner): every
//             `.eq('user_id', user.id)` in the route reads the owner's
//             integrations, social accounts, posts and queue
//   supabase  a client that can read that account: the caller's own session
//             for an owner (RLS as before), the service role for a VA, since
//             the VA's session cannot read the owner's credentials
//             (migration 320). Tokens stay on the server; nothing here sends
//             them to the VA's browser.
//   realUser  the person actually signed in, for "who did this"
//
// THE RULE THAT KEEPS THE SERVICE ROLE SAFE: a route given the service role
// must filter every query by the owner's user_id, or by a row it already
// loaded with that filter. scripts/test-va-publish.ts checks each route.
//
// A VA without "Publish to socials" is refused with a reason, never sent on to
// a half-working publish. Reads (the queue, the account list) need only an
// accepted seat, so a VA can see what is scheduled.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAgencyContext, hasPermission } from '@/lib/agency'

export type PublishContext = {
  /** The account the work is for: the owner (for an owner, themselves). */
  user: User
  /** Reads that account: the session for an owner, the service role for a VA. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>
  /** The person signed in. */
  realUser: User
  /** True for the owner, false for a Virtual Assistant. */
  isOwner: boolean
}

export const VA_NO_PUBLISH_MESSAGE = 'Your account owner has not turned on "Publish to socials" for you. Ask them to switch it on for you on the Virtual Assistants page.'

/** mode 'publish' (default) needs "Publish to socials" for a VA; 'view' needs
 *  only an accepted seat. */
export async function getPublishContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: SupabaseClient<any, any, any>,
  mode: 'publish' | 'view' = 'publish',
): Promise<PublishContext | { error: NextResponse }> {
  const { data: { user } } = await session.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const ctx = await resolveAgencyContext(user.id)
  if (ctx.effectiveOwnerUserId === user.id) return { user, supabase: session, realUser: user, isOwner: true }
  if (mode === 'publish' && !hasPermission(ctx, 'publish_to_socials')) {
    return { error: NextResponse.json({ error: VA_NO_PUBLISH_MESSAGE, vaNoPublish: true }, { status: 403 }) }
  }
  // The owner, as the routes see them: the owner's id, and the owner's email
  // for anything addressed to the account (the VA's own email is on realUser).
  const admin = createAdminClient()
  let email: string | undefined
  try {
    const { data } = await admin.auth.admin.getUserById(ctx.effectiveOwnerUserId)
    email = data?.user?.email ?? undefined
  } catch { /* the id is what matters */ }
  return {
    user: { ...user, id: ctx.effectiveOwnerUserId, email },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: admin as any,
    realUser: user,
    isOwner: false,
  }
}
