/**
 * GET /api/admin/check-token-decrypt[?userId=<uuid>]
 *
 * Read-only diagnostic for the "connected but reads as not-connected" /
 * "keeps asking to reconnect" class of bugs. For each stored secret it reports
 * ONLY three booleans — present, looksEncrypted, decryptsOk — never the token
 * value or ciphertext, so it's safe to hit and safe to paste back.
 *
 * When MVP_CRYPTO_KEY has changed (or differs from the key that encrypted the
 * data), every `enc:v1:` value fails its GCM auth check → decryptIntegrationRow
 * nulls it → the UI shows "not connected". A column that is present:true,
 * looksEncrypted:true, decryptsOk:false across MANY platforms at once is the
 * signature of a key mismatch (not a real disconnect).
 *
 * Auth: admin only. Defaults to the caller; pass ?userId= to inspect another.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isEncrypted, decryptSecret } from '@/lib/secrets'
import { INTEGRATION_SECRET_COLUMNS } from '@/lib/integration-secrets'

export const maxDuration = 30

function probe(v: unknown): { present: boolean; looksEncrypted: boolean; decryptsOk: boolean } {
  if (typeof v !== 'string' || v.length === 0) return { present: false, looksEncrypted: false, decryptsOk: false }
  const enc = isEncrypted(v)
  if (!enc) return { present: true, looksEncrypted: false, decryptsOk: true } // legacy plaintext reads fine
  try { decryptSecret(v); return { present: true, looksEncrypted: true, decryptsOk: true } }
  catch { return { present: true, looksEncrypted: true, decryptsOk: false } }
}

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const targetUser = new URL(req.url).searchParams.get('userId') || user.id
  const admin = createAdminClient()

  // integrations secret columns. Use select('*') NOT an explicit column list:
  // if any listed column doesn't exist in the live schema, Postgres rejects the
  // whole query and every token reads as "absent" — a false negative. '*' never
  // fails on missing columns (the row just won't have that key).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow, error: intErr } = await (admin as any)
    .from('integrations')
    .select('*')
    .eq('user_id', targetUser).maybeSingle()
  if (intErr) return NextResponse.json({ ok: false, error: `integrations read failed: ${intErr.message}` }, { status: 500 })

  const integrations: Record<string, ReturnType<typeof probe>> = {}
  let encTotal = 0, encFail = 0
  for (const col of INTEGRATION_SECRET_COLUMNS) {
    const r = probe(intRow?.[col])
    if (r.present) integrations[col] = r
    if (r.looksEncrypted) { encTotal++; if (!r.decryptsOk) encFail++ }
  }

  // social_accounts (Instagram/Threads/Facebook live here)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: saRows } = await (admin as any)
    .from('social_accounts')
    .select('platform,display_name,access_token')
    .eq('user_id', targetUser)

  const socialAccounts = (saRows ?? []).map((r: { platform: string; display_name: string | null; access_token: string | null }) => {
    const p = probe(r.access_token)
    if (p.looksEncrypted) { encTotal++; if (!p.decryptsOk) encFail++ }
    return { platform: r.platform, displayName: r.display_name, ...p }
  })

  const keyMismatch = encTotal > 0 && encFail === encTotal
  return NextResponse.json({
    ok: true,
    targetUser,
    summary: {
      encryptedValues: encTotal,
      failedToDecrypt: encFail,
      verdict: encTotal === 0 ? 'no-encrypted-tokens'
        : encFail === 0 ? 'all-decrypt-ok'
        : keyMismatch ? 'KEY-MISMATCH: every encrypted token fails to decrypt — MVP_CRYPTO_KEY differs from the key that encrypted them'
        : 'PARTIAL: some encrypted tokens fail — mixed keys or corrupted rows',
    },
    integrations,
    socialAccounts,
  })
}
