/**
 * POST /api/wordpress/clean-links
 *
 * "Lasso refugee" cleanup: scan the creator's published WordPress posts and
 * remove duplicated affiliate-tag artifacts left in the HTML after another
 * plugin (Lasso) was deleted — e.g. `...&tag=creator-20&tag=creator-20`.
 *
 * This is a pure, free text fix: NO article regeneration, NO images, no AI
 * tokens. It reads each post's raw content via the WP REST API, dedupes the
 * tag, and (unless dryRun) writes the cleaned content back.
 *
 * Body: { siteId?, category?, dryRun=true, limit=400 }
 *   - dryRun (default TRUE): only report what WOULD change; never writes.
 *   - category: optional slug (e.g. "blog") to scope the pass.
 *   - limit: hard cap on posts processed.
 *
 * Self-serve + owner-scoped: runs against the authenticated user's OWN
 * connected site (getWordPressCredentials), so there's no cross-account write.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { cleanPostLinks } from '@/lib/clean-affiliate-links'

export const maxDuration = 300

interface RestPost {
  id: number
  link?: string
  content?: string | { raw?: string; rendered?: string }
}

const flatten = (c: RestPost['content']): string =>
  typeof c === 'string' ? c : (c?.raw ?? c?.rendered ?? '')

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const body = await req.json().catch(() => ({})) as {
    siteId?: string | null
    category?: string
    dryRun?: boolean
    limit?: number
  }
  const dryRun = body.dryRun !== false // default TRUE — never write unless explicitly told
  const limit = Math.min(Math.max(1, body.limit ?? 400), 1000)
  const category = (body.category || '').trim()

  const creds = await getWordPressCredentials(supabase, ownerId, body.siteId ?? null)
  if (!creds) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wp = createWordPressService(
    creds.wordpress_url,
    creds.wordpress_username,
    creds.wordpress_app_password,
    creds.wordpress_api_token ?? undefined,
  )

  // Resolve an optional category slug → id so we can scope the pass.
  let categoryId: number | null = null
  if (category) {
    try {
      const cats = await wp.getCustomEndpoint(
        `/wp-json/wp/v2/categories?slug=${encodeURIComponent(category)}&_fields=id`,
      ) as Array<{ id?: number }> | unknown
      if (Array.isArray(cats) && cats[0]?.id) categoryId = Number(cats[0].id)
      if (!categoryId) {
        return NextResponse.json({ error: `No category found with slug "${category}".` }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Could not look up that category.' }, { status: 502 })
    }
  }

  const report: Array<{ id: number; link: string; fixed: number; updated: boolean }> = []
  let scanned = 0
  let totalFixed = 0
  const perPage = 50

  // Page through published posts (raw content via context=edit) and dedupe.
  for (let page = 1; page <= Math.ceil(limit / perPage); page++) {
    const qs = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      context: 'edit',
      status: 'publish',
      _fields: 'id,link,content',
    })
    if (categoryId) qs.set('categories', String(categoryId))

    let rows: RestPost[] = []
    try {
      const data = await wp.getCustomEndpoint(`/wp-json/wp/v2/posts?${qs.toString()}`)
      if (Array.isArray(data)) rows = data as RestPost[]
    } catch {
      break // transient — stop paging, return what we have so far
    }
    if (rows.length === 0) break

    for (const post of rows) {
      if (scanned >= limit) break
      scanned++
      const raw = flatten(post.content)
      const { html, fixed } = cleanPostLinks(raw)
      if (fixed <= 0) continue
      totalFixed += fixed
      let updated = false
      if (!dryRun) {
        try {
          await wp.updatePost(post.id, { content: html })
          updated = true
        } catch {
          updated = false // surface as fixed-but-not-updated in the report
        }
      }
      report.push({ id: post.id, link: post.link || '', fixed, updated })
    }
    if (rows.length < perPage || scanned >= limit) break
  }

  return NextResponse.json({
    dryRun,
    scanned,
    postsWithIssues: report.length,
    duplicateTagsFound: totalFixed,
    postsUpdated: dryRun ? 0 : report.filter(r => r.updated).length,
    posts: report,
  })
}
