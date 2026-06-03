/**
 * Dashboard-facing API-key management endpoints. These are NOT part of the
 * public /api/v1/* surface — they're called from the user's Settings page
 * over a normal Supabase session to mint / list / revoke their own keys.
 *
 *   GET  /api/api-keys           → list (no plaintext, just metadata)
 *   POST /api/api-keys           → mint a new key, body { name }
 *                                  Response includes the PLAINTEXT — caller
 *                                  must show it ONCE; it's never re-exposed.
 *
 * Pro/admin only — Creator/Studio/trial users see "API access requires the
 * Pro tier" with a paywall CTA.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/api-keys'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // List keys for this user. Excludes the hash (never returned to the
  // client — only the prefix for display). Cast through `any` because
  // the Supabase TS types haven't been regenerated since migration 087.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('api_keys')
    .select('id, name, key_prefix, last_used_at, revoked_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Gate behind Pro tier — minting a key on a tier that can't USE the API
  // is a footgun (the key would auth-fail every time downstream).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: 'API access requires the Pro tier',
      code: 'tier_not_allowed',
    }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name || name.length > 80) {
    return NextResponse.json({ error: 'Name must be 1-80 characters' }, { status: 400 })
  }

  const { plaintext, hash, prefix } = generateApiKey()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('api_keys')
    .insert({ user_id: user.id, name, key_hash: hash, key_prefix: prefix })
    .select('id, name, key_prefix, last_used_at, revoked_at, created_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'Failed to mint key' }, { status: 500 })
  }

  // The plaintext is returned ONCE here. The caller must surface it to the
  // user with a "copy now, you won't see this again" warning. There is no
  // endpoint that will return it later — only the hash is stored.
  return NextResponse.json({
    key: data,
    plaintext,
  })
}
