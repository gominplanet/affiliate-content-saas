// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A SIGN-IN TOKEN THAT IS STILL GOOD WHEN IT ARRIVES (Seb, 2026-10-08: a
// Bulk Amazon upload failed with '"exp" claim timestamp check failed'). The
// browser's copy of the sign-in can be stale: a tab left in the background
// stops refreshing it on time, and a computer clock that is off makes an
// expired token look fine here. So a token about to run out is renewed before
// it is used, and one the server calls expired is renewed on the spot.

/** When this token runs out, in ms, read from the token itself. */
export function jwtExpiresAt(token: string | null | undefined): number | null {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return null
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')))
    return typeof json?.exp === 'number' ? json.exp * 1000 : null
  } catch { return null }
}

/** Does the server's answer say the token had run out. */
export function saysExpired(message: string | null | undefined): boolean {
  // Tolerant of the quotes arriving escaped inside a JSON body (\"exp\").
  return /\bexp\W{0,3}\s*claim|jwt expired|token (is )?expired|invalidjwt/i.test(String(message || ''))
}

type Auth = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token: string } | null } }>
    refreshSession: () => Promise<{ data: { session: { access_token: string } | null } }>
  }
}

/** A token good for at least two more minutes, renewed when it is not, or
 *  renewed regardless when `force` (the server just refused it). */
export async function freshAccessToken(supabase: Auth, force = false): Promise<string | null> {
  if (!force) {
    const t = (await supabase.auth.getSession()).data.session?.access_token ?? null
    const exp = jwtExpiresAt(t)
    if (t && exp && exp - Date.now() > 120_000) return t
  }
  try {
    const t = (await supabase.auth.refreshSession()).data.session?.access_token ?? null
    if (t) return t
  } catch { /* fall through to whatever the session holds */ }
  return (await supabase.auth.getSession()).data.session?.access_token ?? null
}
