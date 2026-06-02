/**
 * GET /api/admin/check-crypto-key
 *
 * Diagnostic: verifies MVP_CRYPTO_KEY is set + valid in the current
 * deployment without leaking the key itself. Admin-gated.
 *
 * Use this after setting MVP_CRYPTO_KEY in Vercel to confirm the
 * env var is loaded in the runtime. Vercel doesn't auto-redeploy on
 * env changes — you need a fresh deploy (this commit triggers one
 * via push).
 *
 * The check exercises the encryption helpers end-to-end:
 *   1. Encrypts a known plaintext.
 *   2. Decrypts the result.
 *   3. Verifies round-trip equality.
 *
 * This catches misconfigured keys (wrong length, non-hex chars, missing
 * env) AS WELL AS proves the key is wired correctly through the helpers.
 *
 * Response shape:
 *   { ok: true, keyBytes: 32, prefix: "enc:v1:", roundTrip: "passed" }
 *   { ok: false, error: "MVP_CRYPTO_KEY env var is required..." }
 *
 * Never returns the key itself. Never returns ciphertext that decodes
 * to the user's data. Pure-loopback test on a fixed sentinel string.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin gate — match the existing admin/user-lookup pattern.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // Test encryption end-to-end. Importing dynamically so the route
  // returns a clean error message instead of crashing on module load
  // when MVP_CRYPTO_KEY is missing.
  try {
    const { encryptSecret, decryptSecret } = await import('@/lib/secrets')
    const sample = `mvp-crypto-check-${user.id}`
    const enc = encryptSecret(sample)
    const dec = decryptSecret(enc)
    if (dec !== sample) {
      return NextResponse.json({ ok: false, error: 'Round-trip mismatch (key works but produces wrong output)' }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      keyBytes: 32,
      prefix: enc.slice(0, 7), // "enc:v1:" — proves the format version we shipped
      roundTrip: 'passed',
      note: 'MVP_CRYPTO_KEY is set + valid. Encryption helpers are live.',
    })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'crypto check failed',
    }, { status: 500 })
  }
}
