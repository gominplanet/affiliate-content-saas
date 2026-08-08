// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-user external API keys for Labs integrations (Levanta, PartnerBoost, …).
// Keys live encrypted in `external_api_keys` (migration 133) and are read with a
// fallback to the shared server env var, so the operator's admin key keeps
// working while Pro users bring their own. The decrypted key NEVER leaves the
// server — the management API only ever exposes a masked last-4.

import type { createServerClient } from '@/lib/supabase/server'
import { maybeEncrypt, maybeDecrypt } from '@/lib/secrets'

export type ExternalProvider = 'levanta' | 'partnerboost' | 'wayward'
export const EXTERNAL_PROVIDERS: ExternalProvider[] = ['levanta', 'partnerboost', 'wayward']

export function isExternalProvider(v: unknown): v is ExternalProvider {
  return typeof v === 'string' && (EXTERNAL_PROVIDERS as string[]).includes(v)
}

/** The shared env-var key for a provider. This is the OPERATOR's own account
 *  key — it must NEVER be handed to another user, or every user would see the
 *  operator's connected brands/products. Gated to admin only below. */
function envKeyFor(provider: ExternalProvider): string | null {
  const v = provider === 'levanta' ? process.env.LEVANTA_API_TOKEN
    : provider === 'partnerboost' ? process.env.PARTNERBOOST_API_TOKEN
    : process.env.WAYWARD_API_TOKEN
  return v?.trim() || null
}

type SB = Awaited<ReturnType<typeof createServerClient>>

/** True only for the operator (integrations.tier === 'admin'). Fails closed. */
async function isAdminUser(sb: SB, userId: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb as any)
      .from('integrations').select('tier').eq('user_id', userId).maybeSingle()
    return data?.tier === 'admin'
  } catch { return false }
}

/**
 * Decrypted key for one provider: the user's OWN key if they set one, else null.
 * The shared env key is returned ONLY for the operator (admin) — regular users
 * see nothing until they insert their own key (the env key is the operator's
 * private account and must not leak across users). Tolerates a pre-migration DB.
 */
export async function getExternalKey(sb: SB, userId: string, provider: ExternalProvider): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb as any)
      .from('external_api_keys')
      .select('encrypted_key')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle()
    if (data?.encrypted_key) {
      const k = maybeDecrypt(data.encrypted_key)?.trim()
      if (k) return k
    }
  } catch { /* table absent pre-migration → no per-user key */ }
  // Only the operator inherits the shared env key. Everyone else = blank.
  return (await isAdminUser(sb, userId)) ? envKeyFor(provider) : null
}

export async function setExternalKey(sb: SB, userId: string, provider: ExternalProvider, key: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).from('external_api_keys').upsert({
    user_id: userId,
    provider,
    encrypted_key: maybeEncrypt(key.trim()),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })
}

export async function deleteExternalKey(sb: SB, userId: string, provider: ExternalProvider): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).from('external_api_keys').delete().eq('user_id', userId).eq('provider', provider)
}

export interface ExternalKeyStatus { connected: boolean; last4: string | null; viaEnv: boolean }

/**
 * Masked connection status per provider for the UI. Never returns the key.
 * `viaEnv` = no per-user key but the shared env key is present (so the tool
 * still works via the operator's account).
 */
export async function externalKeyStatus(sb: SB, userId: string): Promise<Record<ExternalProvider, ExternalKeyStatus>> {
  const out = {} as Record<ExternalProvider, ExternalKeyStatus>
  // viaEnv drives the UI's "connected via MVP" state — gate it to the operator
  // so regular users show as not-connected until they add their own key.
  const admin = await isAdminUser(sb, userId)
  for (const p of EXTERNAL_PROVIDERS) out[p] = { connected: false, last4: null, viaEnv: admin && !!envKeyFor(p) }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb as any).from('external_api_keys').select('provider,encrypted_key').eq('user_id', userId)
    for (const row of (data || [])) {
      const prov: unknown = row.provider
      if (!isExternalProvider(prov)) continue
      const k = maybeDecrypt(row.encrypted_key) || ''
      out[prov] = { connected: true, last4: k.slice(-4) || null, viaEnv: out[prov].viaEnv }
    }
  } catch { /* table absent → all show not-connected (env fallback flag stands) */ }
  return out
}
