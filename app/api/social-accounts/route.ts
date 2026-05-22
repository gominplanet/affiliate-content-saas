/**
 * GET /api/social-accounts[?platform=facebook|instagram]
 *
 * Returns the signed-in user's connected social destinations (FB Pages, IG
 * accounts) for the per-post account picker. Token-stripped — access tokens
 * never leave the server. Owner-scoped by RLS + the explicit user filter.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { listSocialAccounts, type SocialPlatform } from '@/lib/social-accounts'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
