/**
 * POST /api/seo/indexnow
 *
 * Pushes the user's published post URLs to IndexNow (Bing / Copilot / Yandex)
 * for near-instant crawling. The per-site IndexNow key is hosted + reported by
 * the MVP WordPress plugin (v1.0.11+); we read it from the plugin's /status
 * endpoint, then submit. (Google doesn't support IndexNow — for Google the
 * sitemap + GSC are the levers.)
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { submitToIndexNow } from '@/lib/indexnow'

export const maxDuration = 60

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password')
    .eq('user_id', user.id).single()
  if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpBase = wp.wordpress_url.replace(/\/$/, '')
  const auth = `Basic ${Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`

  // Read the IndexNow key the plugin generates + hosts at /{key}.txt.
  let key = ''
  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) })
    if (res.ok) { const s = await res.json().catch(() => ({})); key = (s?.indexnow_key as string) || '' }
  } catch { /* fall through to the helpful error below */ }
  if (!key) {
    return NextResponse.json({ error: 'IndexNow isn’t available yet — update the MVP plugin (Setup → reinstall) to v1.0.11+, which hosts the IndexNow key. Then try again.' }, { status: 409 })
  }

  // Build the list of published post URLs from their slugs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: posts } = await (supabase as any)
    .from('blog_posts')
    .select('slug')
    .eq('user_id', user.id)
    .not('wordpress_post_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(2000)
  const urls = ((posts ?? []) as { slug: string | null }[])
    .map(p => p.slug ? `${wpBase}/${p.slug}` : null)
    .filter((u): u is string => !!u)
  if (urls.length === 0) return NextResponse.json({ error: 'No published posts to submit.' }, { status: 422 })

  const result = await submitToIndexNow(wpBase, key, urls)
  if (!result.ok) {
    return NextResponse.json({ error: `IndexNow rejected the request (status ${result.status}). Make sure ${wpBase}/${key}.txt is reachable.` }, { status: 502 })
  }
  return NextResponse.json({ ok: true, submitted: result.submitted })
}
