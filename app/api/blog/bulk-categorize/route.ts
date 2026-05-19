import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { createAnthropicClient } from '@/lib/anthropic'

export const maxDuration = 300

/**
 * Re-categorize existing published posts using the user's brand niches.
 *
 * Targets posts that currently only have "Uncategorized" or "Blog" (the
 * WP default + our legacy default) — i.e. posts that never got a real
 * niche category. Leaves posts that already have a non-default category
 * alone (we assume the user assigned those intentionally).
 *
 * Sends every target post's title to a single batched Anthropic call,
 * constrained to pick one of the brand's selected niches verbatim. We
 * then create/look-up the category in WP and assign it.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { dryRun = false } = await request.json().catch(() => ({}))

    // ── Fetch brand niches (the allowed category labels) ─────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brandRow } = await (supabase as any)
      .from('brand_profiles')
      .select('niches')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const niches = ((brandRow as any)?.niches as string[] | undefined) ?? []
    if (niches.length === 0) {
      return NextResponse.json({
        error: 'No brand niches selected. Go to Brand Profile and pick at least one Affiliate Niche before re-categorizing.',
      }, { status: 400 })
    }

    // ── Fetch WP credentials ─────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: integration } = await (supabase as any)
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = integration as Record<string, string> | null
    if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
    }

    const wpBase = wp.wordpress_url.replace(/\/$/, '')
    const authHeader = `Basic ${Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`

    const wpService = createWordPressService(
      wp.wordpress_url,
      wp.wordpress_username,
      wp.wordpress_app_password,
      wp.wordpress_api_token || undefined,
    )

    // ── Fetch all published posts ────────────────────────────────────────
    const allPosts: { id: number; title: { rendered: string }; categories: number[] }[] = []
    let page = 1
    while (true) {
      const res = await fetch(
        `${wpBase}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,title,categories`,
        { headers: { Authorization: authHeader } },
      )
      if (!res.ok) break
      const batch = await res.json() as typeof allPosts
      if (!batch.length) break
      allPosts.push(...batch)
      const total = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= total) break
      page++
    }

    // ── Identify "default" category IDs (Uncategorized + Blog) ──────────
    // WP REST does NOT accept a comma-joined `slug` param, so the old
    // `?slug=uncategorized,blog` matched nothing and Blog-categorized
    // posts were never detected (Fix Categories did nothing). Pull ALL
    // categories and match by slug OR name (covers a real "Blog"
    // category AND an "Uncategorized" that was renamed to "Blog").
    const DEFAULT_NAMES = new Set(['uncategorized', 'blog'])
    const allCats: { id: number; slug: string; name: string }[] = []
    let catPage = 1
    while (true) {
      const cr = await fetch(
        `${wpBase}/wp-json/wp/v2/categories?per_page=100&page=${catPage}&_fields=id,slug,name`,
        { headers: { Authorization: authHeader } },
      )
      if (!cr.ok) break
      const cb = (await cr.json().catch(() => [])) as typeof allCats
      if (!cb.length) break
      allCats.push(...cb)
      const ct = parseInt(cr.headers.get('X-WP-TotalPages') || '1', 10)
      if (catPage >= ct) break
      catPage++
    }
    const defaultCatIds = new Set(
      allCats
        .filter((c) =>
          DEFAULT_NAMES.has((c.slug || '').toLowerCase()) ||
          DEFAULT_NAMES.has((c.name || '').toLowerCase()),
        )
        .map((c) => c.id),
    )

    const needsCat = allPosts.filter((p) =>
      p.categories.length === 0 ||
      p.categories.every((c) => defaultCatIds.has(c)),
    )

    if (needsCat.length === 0) {
      return NextResponse.json({
        fixed: 0,
        total: allPosts.length,
        message: 'All posts already have a real niche category.',
      })
    }

    // ── Ask Claude to classify each title into ONE of the brand niches ─
    const client = createAnthropicClient()
    const titlesList = needsCat
      .map((p, i) => `${i + 1}. ${p.title.rendered.replace(/<[^>]+>/g, '')}`)
      .join('\n')

    const nichesList = niches.map((n) => `"${n}"`).join(', ')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `You are categorizing affiliate product review posts into a fixed list of niches.

For each post below, pick EXACTLY ONE niche label from this list — copy it verbatim (same capitalization, same "&"):
${nichesList}

If multiple niches plausibly fit, prefer the more specific one. If none seem to fit, still pick the closest match — do NOT invent a new label and do NOT leave it blank.

Respond with ONLY a JSON array, one object per post in input order:
[{"index": 1, "category": "Home & Kitchen"}, ...]

Posts to classify:
${titlesList}`,
      }],
    })

    const raw = (response.content[0] as { type: string; text: string }).text.trim()
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI returned unexpected format', raw: raw.slice(0, 300) }, { status: 500 })
    }
    let classifications: { index: number; category: string }[]
    try {
      classifications = JSON.parse(jsonMatch[0])
    } catch (e) {
      return NextResponse.json({
        error: 'Failed to parse AI classification JSON',
        detail: e instanceof Error ? e.message : String(e),
        raw: raw.slice(0, 300),
      }, { status: 500 })
    }

    // Constrain each classification to the brand's niche list (case-insensitive).
    const nichesLowered = niches.map((n) => n.toLowerCase())
    const normalized = classifications.map((c) => {
      const idx = nichesLowered.indexOf((c.category || '').toLowerCase())
      return { index: c.index, category: idx >= 0 ? niches[idx] : niches[0] }
    })

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        total: allPosts.length,
        toFix: needsCat.length,
        niches,
        preview: normalized.map((c) => ({
          title: needsCat[c.index - 1]?.title.rendered.replace(/<[^>]+>/g, ''),
          category: c.category,
        })),
      })
    }

    // ── Resolve / create categories then update posts ───────────────────
    const categoryCache: Record<string, number> = {}
    let fixed = 0
    const errors: string[] = []

    for (const { index, category } of normalized) {
      const post = needsCat[index - 1]
      if (!post) continue
      try {
        if (!categoryCache[category]) {
          categoryCache[category] = await wpService.createCategory(category)
        }
        const catId = categoryCache[category]
        // Replace ALL categories with just the niche category. We don't
        // want to keep the legacy "Blog" assignment alongside the real
        // niche — that would defeat the homepage's category-section
        // logic which is based on category counts.
        await wpService.updatePost(post.id, { categories: [catId] } as never)
        fixed++
      } catch (err) {
        errors.push(`Post ${post.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // We had posts to fix but none succeeded — that's a failure, not
    // "all good". Surface why instead of the misleading
    // "already had categories" the UI shows on fixed === 0.
    if (fixed === 0 && needsCat.length > 0) {
      return NextResponse.json({
        error: `Couldn't update any of the ${needsCat.length} post${needsCat.length !== 1 ? 's' : ''} in WordPress. ${errors[0] ?? 'Unknown WordPress error.'}`,
        attempted: needsCat.length,
        errors: errors.slice(0, 10),
      }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      total: allPosts.length,
      fixed,
      skipped: allPosts.length - needsCat.length,
      niches,
      partial: errors.length > 0 ? `${errors.length} post${errors.length !== 1 ? 's' : ''} failed` : null,
      errors: errors.slice(0, 10),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
