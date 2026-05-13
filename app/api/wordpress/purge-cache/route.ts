import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password, blog_customizations')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  const wpBase = intRow.wordpress_url.replace(/\/$/, '')

  // Build auth header if credentials are available
  const authHeader = (intRow.wordpress_username && intRow.wordpress_app_password)
    ? `Basic ${Buffer.from(`${intRow.wordpress_username}:${intRow.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`
    : undefined

  // Always GET current WP customizations first, then re-POST the same data.
  // This triggers litespeed_purge_all without ever overwriting stored data with empty.
  let existing: unknown = {}
  try {
    const getRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
      headers: authHeader ? { Authorization: authHeader } : {},
    })
    if (getRes.ok) existing = await getRes.json()
  } catch { /* start fresh */ }

  // If WP has data, re-post it (purges cache, preserves data).
  // If WP is empty but Supabase has data, post Supabase data (restores + purges).
  // If both empty, post empty (purge only — no data to lose).
  const payload = (existing && typeof existing === 'object' && !Array.isArray(existing) && Object.keys(existing).length > 0)
    ? existing
    : (intRow.blog_customizations ?? {})

  const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/customizations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `WordPress returned ${res.status}: ${text.slice(0, 100)}` }, { status: 500 })
  }

  // Legacy Code Snippets refresh removed — the MVP Affiliate Plugin + Theme
  // architecture owns all rendering. Purging the WP page cache via the POST
  // above (which triggers litespeed_purge_all) is sufficient.
  const debug: Record<string, unknown> = {}

  return NextResponse.json({ ok: true, debug })
}
