/**
 * POST /api/tools/duplicates/resolve
 *
 * Merges duplicate posts found by /tools/duplicates: for each group, 301-redirect
 * every EXTRA's URL to the chosen KEEPER, then move the extra to WordPress Trash
 * (recoverable, not force-deleted). Consolidates split rankings + link equity and
 * leaves no 404 behind.
 *
 * Body: { merges: [{ keeperUrl: string, extras: [{ wordpressPostId: number, url: string }] }] }
 *
 * The heavy lifting runs INSIDE WordPress via the plugin's /merge-duplicates
 * endpoint (v1.0.65+) — auth'd by the body proxy_secret so it survives hosts that
 * strip Authorization on POST — so there's one WAF-proof call per request. We then
 * mark the trashed extras in blog_posts so they drop off the Library + next scan.
 *
 * Access: Creator+. Owner-scoped — uses the owner's own WordPress credentials, so
 * a user can only ever touch their own site.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 60

interface Extra { wordpressPostId?: number | null; url?: string }
interface Merge { keeperUrl?: string; extras?: Extra[] }

function pathOf(url: string): string {
  try { return new URL(url).pathname } catch { return '' }
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
    if (tier === 'trial') return NextResponse.json({ error: 'Upgrade to Creator or higher to merge duplicate posts.' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { merges?: Merge[] }
    const merges = (body.merges || [])
      .map(m => ({
        keeper: (m.keeperUrl || '').trim(),
        extras: (m.extras || [])
          .map(e => ({ id: typeof e.wordpressPostId === 'number' ? e.wordpressPostId : 0, path: pathOf(e.url || '') }))
          .filter(e => e.id > 0 && e.path),
      }))
      .filter(m => m.keeper && m.extras.length > 0)
    if (merges.length === 0) return NextResponse.json({ error: 'Nothing to merge.' }, { status: 400 })

    const creds = await getWordPressCredentials(supabase, ownerId)
    if (!creds) return NextResponse.json({ error: 'WordPress isn’t connected — connect it in Setup, then try again.' }, { status: 400 })

    const wpBase = creds.wordpress_url.replace(/\/$/, '')
    const authHeader = `Basic ${Buffer.from(`${creds.wordpress_username}:${(creds.wordpress_app_password || '').replace(/\s+/g, '')}`).toString('base64')}`
    let plugin: { ok?: boolean; trashed?: number; redirected?: number; errors?: string[]; error?: string }
    try {
      const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/merge-duplicates`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: creds.wordpress_api_token || '', merges }),
        signal: AbortSignal.timeout(45_000),
      })
      if (res.status === 404) {
        return NextResponse.json({ error: 'Merge needs the MVP plugin v1.0.65+ on this site — update it (dashboard “Update now” or Setup → reinstall), then try again.' }, { status: 409 })
      }
      plugin = await res.json().catch(() => ({})) as typeof plugin
      if (!res.ok || !plugin?.ok) {
        return NextResponse.json({ error: plugin?.error || `WordPress returned ${res.status}.` }, { status: 502 })
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'WordPress unreachable' }, { status: 502 })
    }

    // Mark the trashed extras in our DB so they drop off the Library + next scan.
    const trashedWpIds = merges.flatMap(m => m.extras.map(e => e.id))
    if (trashedWpIds.length) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('blog_posts') as any)
          .update({ status: 'trashed' })
          .eq('user_id', ownerId)
          .in('wordpress_post_id', trashedWpIds)
      } catch { /* non-fatal — the WP trash + redirect already succeeded */ }
    }

    return NextResponse.json({ ok: true, trashed: plugin.trashed ?? 0, redirected: plugin.redirected ?? 0, errors: plugin.errors ?? [] })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Merge failed' }, { status: 500 })
  }
}
