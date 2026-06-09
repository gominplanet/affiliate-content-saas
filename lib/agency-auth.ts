// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Single-line auth + owner-id resolution for resource routes.
//
// Phase 2 (2026-06-09) ships VA resource sharing. Every API route that
// loads/writes user-scoped resources needs to:
//   1. Auth-gate on the actual logged-in user (audit / caps / tracking)
//   2. Look up resources under the OWNER's user_id when the caller is a VA
//
// Doing those two steps inline in every route is noisy and easy to
// inconsistently mix up. This helper folds them into one call:
//
//     const { user, ownerId, error } = await getAuthAndOwner(supabase)
//     if (error) return error
//
//     // resource queries → ownerId
//     .eq('user_id', ownerId)
//
//     // audit / caps / generation tracking → user.id
//     await recordUsage(user.id, ...)
//
// `ownerId === user.id` when the caller IS the owner — no extra DB hit
// is wasted because getOwnerUserId returns the same id directly when
// no agency membership row exists.

import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getOwnerUserId } from '@/lib/agency'

export interface AuthAndOwner {
  /** The actually-logged-in user. Use for: audit trail, usage caps,
   *  tracking who triggered an action, notifications, billing. */
  user: User
  /** The user_id whose resources should be queried. For owners this
   *  equals user.id; for accepted VAs this is the parent owner's id. */
  ownerId: string
  /** Convenience flag — true when the caller IS the owner (not a VA). */
  isOwner: boolean
  /** Always undefined when this object is the return value of a
   *  successful call — but lets callers do `if (error) return error`
   *  without an extra null-check on user/ownerId. */
  error?: undefined
}

export interface AuthError {
  user?: undefined
  ownerId?: undefined
  isOwner?: undefined
  /** Ready-to-return NextResponse for an unauthorized caller. */
  error: NextResponse
}

/**
 * Authenticate the caller and resolve the owner-account they should
 * see. Returns either { user, ownerId, isOwner } or { error: 401-response }.
 *
 * Designed to make the route-level pattern a single line:
 *
 *     const auth = await getAuthAndOwner(supabase)
 *     if (auth.error) return auth.error
 *     const { user, ownerId, isOwner } = auth
 *
 * Use `ownerId` for resource lookups so VAs see the parent's data.
 * Use `user.id` for audit / caps so the action is logged against the
 * person who actually performed it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAuthAndOwner(supabase: SupabaseClient<any, any, any>): Promise<AuthAndOwner | AuthError> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const ownerId = await getOwnerUserId(user.id)
  return {
    user,
    ownerId,
    isOwner: ownerId === user.id,
  }
}
