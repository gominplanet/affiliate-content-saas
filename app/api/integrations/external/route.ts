/**
 * External integration keys API (Labs). Pro + admin only; the LABS password gate
 * is enforced in middleware. Lets a user connect/disconnect their own API key
 * for an external provider (Levanta, PartnerBoost, …). The decrypted key never
 * leaves the server — GET returns only a masked last-4.
 *
 *   GET                      → { ok, status: { levanta: {connected,last4,viaEnv}, … } }
 *   POST   { provider, key } → store (encrypted)
 *   DELETE { provider }      → remove
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import {
  isExternalProvider, setExternalKey, deleteExternalKey, externalKeyStatus, cleanPastedKey,
} from '@/lib/external-keys'
import { verifyPartnerBoostToken } from '@/services/partnerboost'
import { createAdminClient } from '@/lib/supabase/admin'
import { PB_TOKEN_WHERE } from '@/lib/partnerboost-copy'

export const dynamic = 'force-dynamic'

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier)
  if (tier === 'trial') {
    return { error: NextResponse.json({ ok: false, error: 'External integrations require a paid plan.' }, { status: 403 }) }
  }
  return { supabase, userId: user.id }
}

export async function GET() {
  const g = await gate(); if (g.error) return g.error
  return NextResponse.json({ ok: true, status: await externalKeyStatus(g.supabase!, g.userId!) })
}

export async function POST(request: NextRequest) {
  const g = await gate(); if (g.error) return g.error
  const body = await request.json().catch(() => ({}))
  const provider = body?.provider
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!isExternalProvider(provider)) return NextResponse.json({ ok: false, error: 'Unknown provider' }, { status: 400 })
  if (!key) return NextResponse.json({ ok: false, error: 'API key required' }, { status: 400 })
  // A PartnerBoost token is checked with PartnerBoost before it is kept, so
  // "Connected" means PartnerBoost knows it, not just that it was saved.
  let check: { known: boolean; code: number | null; msg: string } | null = null
  if (provider === 'partnerboost') {
    check = await verifyPartnerBoostToken(cleanPastedKey(key))
    if (!check.known) {
      const said = check.msg ? `PartnerBoost says "${check.msg}"` : 'PartnerBoost did not answer'
      return NextResponse.json({ ok: false, error: `${said}${check.code != null ? ` (code ${check.code})` : ''}, so the token was not saved. ${PB_TOKEN_WHERE}`, check }, { status: 422 })
    }
  }
  try {
    await setExternalKey(g.supabase!, g.userId!, provider, key)
    // A working token clears the sync's 12 hour back-off at once.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (provider === 'partnerboost') await (createAdminClient() as any).from('system_flags').delete().eq('key', `pb_sync_failed:${g.userId}`)
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'The key was not saved.' }, { status: 500 })
  }
  // What is now in use, read back (its last 4 characters), so the screen shows
  // the result of the save and not just that it was pressed.
  return NextResponse.json({ ok: true, status: await externalKeyStatus(g.supabase!, g.userId!), check })
}

export async function DELETE(request: NextRequest) {
  const g = await gate(); if (g.error) return g.error
  const body = await request.json().catch(() => ({}))
  const provider = body?.provider
  if (!isExternalProvider(provider)) return NextResponse.json({ ok: false, error: 'Unknown provider' }, { status: 400 })
  await deleteExternalKey(g.supabase!, g.userId!, provider)
  return NextResponse.json({ ok: true })
}
