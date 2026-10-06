/**
 * GET /api/social-accounts[?platform=facebook|instagram]
 *
 * Returns the signed-in user's connected social destinations (FB Pages, IG
 * accounts) for the per-post account picker. Token-stripped — access tokens
 * never leave the server. Owner-scoped by RLS + the explicit user filter.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { listSocialAccounts, type SocialPlatform } from '@/lib/social-accounts'

export async function GET(request: NextRequest) {
  try {
    // A Virtual Assistant sees the owner's (lib/agency-publish).
    const pub = await getPublishContext(await createServerClient(), 'view')
    if ('error' in pub) return pub.error
    const { supabase, user } = pub

    const platformParam = new URL(request.url).searchParams.get('platform')
    const platform = (platformParam === 'facebook' || platformParam === 'instagram')
      ? (platformParam as SocialPlatform)
      : undefined

    const accounts = await listSocialAccounts(supabase, user.id, platform)
    return NextResponse.json({ ok: true, accounts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
