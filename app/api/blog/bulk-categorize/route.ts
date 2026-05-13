import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { createAnthropicClient } from '@/lib/anthropic'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { dryRun = false } = await request.json().catch(() => ({}))

    // ── Fetch WP credentials ──────────────────────────────────────────────────
    const { data: integration } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .single()

    const wp = integration as Record<string, string> | null
    if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
      return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
    }

    const wpService = createWordPressService(
      wp.wordpress_url,
      wp.wordpress_username,
      wp.wordpress_app_password,
      wp.wordpress_api_token || undefined,
    )

    // ── Fetch all posts from WP (paginated) ───────────────────────────────────
    const allPosts: { id: number; title: { rendered: string }; categories: number[] }[] = []
    let page = 1
    while (true) {
      const res = await fetch(
        `${wp.wordpress_url.replace(/\/$/, '')}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&_fields=id,title,categories`,
        { headers: { Authorization: `Basic ${Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}` } },
      )
      if (!res.ok) break
      const batch = await res.json() as typeof allPosts
      if (!batch.length) break
      allPosts.push(...batch)
      const total = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
      if (page >= total) break
      page++
    }

    // ── Fetch "Uncategorized" category ID ─────────────────────────────────────
    const catRes = await fetch(
      `${wp.wordpress_url.replace(/\/$/, '')}/wp-json/wp/v2/categories?slug=uncategorized&per_page=1`,
      { headers: { Authorization: `Basic ${Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}` } },
    )
    const uncatList = await catRes.json() as { id: number }[]
    const uncategorizedId = uncatList[0]?.id ?? 1

    // Posts that only have "Uncategorized" (or no categories)
    const needsCat = allPosts.filter(p =>
      p.categories.length === 0 ||
      (p.categories.length === 1 && p.categories[0] === uncategorizedId),
    )

    if (needsCat.length === 0) {
      return NextResponse.json({ fixed: 0, total: allPosts.length, message: 'All posts already have categories.' })
    }

    // ── Ask Claude to classify all titles at once ─────────────────────────────
    const client = createAnthropicClient()
    const titles = needsCat.map((p, i) => `${i + 1}. ${p.title.rendered.replace(/<[^>]+>/g, '')}`).join('\n')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are categorizing blog posts about product reviews and affiliate content.

For each post title below, assign ONE short category name (2-4 words max, title case, e.g. "Golf Drivers", "Rangefinders", "Golf Bags", "Golf Shoes", "Putters", "Golf Irons", "GPS Devices", "Golf Accessories").

Respond with ONLY a JSON array of objects: [{"index": 1, "category": "Category Name"}, ...]

Post titles:
${titles}`,
      }],
    })

    const raw = (response.content[0] as { type: string; text: string }).text.trim()
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Claude returned unexpected format', raw }, { status: 500 })
    }
    const classifications: { index: number; category: string }[] = JSON.parse(jsonMatch[0])

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        total: allPosts.length,
        toFix: needsCat.length,
        preview: classifications.map((c) => ({
          title: needsCat[c.index - 1]?.title.rendered.replace(/<[^>]+>/g, ''),
          category: c.category,
        })),
      })
    }

    // ── Create/resolve categories and assign to posts ─────────────────────────
    const categoryCache: Record<string, number> = {}
    let fixed = 0
    const errors: string[] = []

    for (const { index, category } of classifications) {
      const post = needsCat[index - 1]
      if (!post) continue
      try {
        if (!categoryCache[category]) {
          categoryCache[category] = await wpService.createCategory(category)
        }
        const catId = categoryCache[category]
        await wpService.updatePost(post.id, { categories: [catId] } as never)
        fixed++
      } catch (err) {
        errors.push(`Post ${post.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return NextResponse.json({
      success: true,
      total: allPosts.length,
      fixed,
      skipped: allPosts.length - needsCat.length,
      errors: errors.slice(0, 10),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
