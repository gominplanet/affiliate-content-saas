// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// When an account was created, which is what the free month is measured from.
//
// Kept OUT of lib/free-trial.ts on purpose. That file is pure and is imported by
// the pricing page, the sales page and /join/amazon, all of which render in the
// browser. Putting a service-role Supabase import in it would drag server code
// into the client bundle for the sake of one date.
//
// The date comes from auth.users rather than a column on integrations, because
// auth.users.created_at is the one timestamp that certainly exists for every
// account and needs no migration. Signup is also the honest start: the row on
// integrations can be written later than the account.
//
// A date we cannot read returns null, and freeTrialWindow treats null as "not
// expired". A lookup failure must never be the reason somebody's account stops
// working; the per-feature caps still hold either way.

import { createAdminClient } from '@/lib/supabase/admin'

/** Per-instance memo. Three routes can ask for the same account inside one
 *  session and the answer cannot change, so one lookup per warm instance is
 *  plenty. Bounded so a busy instance cannot grow this without limit. */
const memo = new Map<string, string | null>()
const MEMO_MAX = 500

export async function accountSignupISO(userId: string): Promise<string | null> {
  if (!userId) return null
  if (memo.has(userId)) return memo.get(userId) ?? null
  let iso: string | null = null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (!error && data?.user?.created_at) iso = new Date(data.user.created_at).toISOString()
  } catch {
    iso = null
  }
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(userId, iso)
  return iso
}
