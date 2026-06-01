import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { tryWpProxy } from '@/lib/wp-proxy'

/**
 * Purge cache on a WordPress site. Multi-site: accepts `siteId` to target a
 * specific site; omitted → user's default site.
 *
 * Posts the existing customizations back to the site (which triggers
 * litespeed_purge_all in the MVP plugin) without overwriting stored data.
 */
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { siteId?: string | null }

  // Per-user blog customizations (per-user data; per-site routing).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('blog_customizations')
    .eq('user_id', user.id)
    .single()

  const site = await getWordPressCredentials(supabase, user.id, body.siteId)
  if (!site) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const authHeader = `Basic ${Buffer.from(`${site.wordpress_username}:${site.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`

  // Always GET current WP customizations first, then re-POST the same data.
  // This triggers litespeed_purge_all without ever overwriting stored data with empty.
  // Identify ourselves with a normal-looking User-Agent. Some hosts / security
  // plugins (Wordfence, mod_security, host WAFs) 403 REST writes that arrive
  // with no / a "node"-style UA. Harmless on permissive sites.
  const UA = 'MVP Affiliate/1.0 (+https://www.mvpaffiliate.io)'

  let existing: unknown = {}
  try {
    const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
      headers: { 'User-Agent': UA, Authorization: authHeader },
    })
    if (getRes.ok) existing = await getRes.json()
  } catch { /* start fresh */ }

  // If WP has data, re-post it (purges cache, preserves data).
  // If WP is empty but Supabase has data, post Supabase data (restores + purges).
  // If both empty, post empty (purge only — no data to lose).
  const payload = (existing && typeof existing === 'object' && !Array.isArray(existing) && Object.keys(existing).length > 0)
    ? existing
    : (intRow?.blog_customizations ?? {})

  // Prefer the body-auth proxy when available (plugin v1.0.25+) — the
  // write triggers litespeed_purge_all server-side without needing the
  // Authorization header to survive POST.
  const proxied = await tryWpProxy({
    siteUrl: wpBase,
    proxySecret: site.wordpress_api_token,
    innerPath: '/affiliateos/v1/customizations',
    method: 'POST',
    body: payload as Record<string, unknown>,
  })

  let ok = false
  let status = 0
  let errText = ''
  if (proxied) {
    ok = proxied.ok
    status = proxied.status
    if (!ok) errText = typeof proxied.data === 'string' ? proxied.data : JSON.stringify(proxied.data)
  } else {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    })
    ok = res.ok
    status = res.status
    if (!ok) errText = await res.text()
  }

  if (!ok) {
    // A 403 here means WP authenticated the user but a capability check or a
    // security layer (Wordfence / host WAF / "disable REST API" plugin) blocked
    // the write. Surface more of the body so the real reason is visible.
    const hint = status === 403
      ? ' — your site blocked the write. Make sure the connected WordPress user is an Administrator, and that a security plugin or host firewall isn\'t blocking REST API writes.'
      : ''
    return NextResponse.json({ error: `WordPress returned ${status}: ${errText.slice(0, 300)}${hint}` }, { status: 500 })
  }

  // Legacy Code Snippets refresh removed — the MVP Affiliate Plugin + Theme
  // architecture owns all rendering. Purging the WP page cache via the POST
  // above (which triggers litespeed_purge_all) is sufficient.
  const debug: Record<string, unknown> = {}

  return NextResponse.json({ ok: true, debug })
}
