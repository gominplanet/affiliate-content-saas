/**
 * POST /api/tools/redirects/apply
 *
 * The write half of the 404 → 301 tool. Persists approved redirects to the MVP
 * plugin's redirect store (v1.0.65+), which then 301s each dead URL to its target
 * whenever WordPress would otherwise serve a 404.
 *
 * Body: { redirects: [{ from: string (path), to: string (url) }] }
 *
 * Auth to the plugin uses the body proxy_secret so it survives hosts that strip
 * Authorization on POST — the same WAF-proof path used to publish + merge.
 *
 * Access: Creator+. Owner-scoped.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 45

interface Pair { from?: string; to?: string }

function normPath(u: string): string {
  let p = (u || '').trim()
  try { p = new URL(p).pathname } catch { /* already a path */ }
  p = '/' + p.replace(/[?#].*$/, '').trim().replace(/^\/+|\/+$/g, '')
  if (p !== '/') p += '/'
  return p.toLowerCase()
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
    const tier = normalizeTier((tierRow?.tier as Tier) ?? 'trial')
    if (tier === 'trial') return NextResponse.json({ error: 'Upgrade to Creator or higher to fix 404s.' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { redirects?: Pair[] }
    const redirects = (body.redirects || [])
      .map(r => ({ from: normPath(r.from || ''), to: (r.to || '').trim() }))
      .filter(r => r.from && r.from !== '/' && /^https?:\/\//i.test(r.to) && normPath(r.to) !== r.from)
      .slice(0, 1000)
    if (redirects.length === 0) return NextResponse.json({ error: 'No valid redirects to apply.' }, { status: 400 })

    const creds = await getWordPressCredentials(supabase, ownerId)
    if (!creds) return NextResponse.json({ error: 'WordPress isn’t connected.' }, { status: 400 })

    const wpBase = creds.wordpress_url.replace(/\/$/, '')
    const authHeader = `Basic ${Buffer.from(`${creds.wordpress_username}:${(creds.wordpress_app_password || '').replace(/\s+/g, '')}`).toString('base64')}`
    try {
      const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/redirects`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: creds.wordpress_api_token || '', redirects }),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 404) {
        return NextResponse.json({ error: 'Redirects need the MVP plugin v1.0.65+ on this site — update it, then try again.' }, { status: 409 })
      }
      const data = await res.json().catch(() => ({})) as { ok?: boolean; count?: number; error?: string }
      if (!res.ok || !data?.ok) return NextResponse.json({ error: data?.error || `WordPress returned ${res.status}.` }, { status: 502 })
      return NextResponse.json({ ok: true, applied: redirects.length, total: data.count ?? redirects.length })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'WordPress unreachable' }, { status: 502 })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Apply failed' }, { status: 500 })
  }
}
