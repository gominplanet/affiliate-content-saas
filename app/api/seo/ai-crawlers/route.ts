/**
 * GET /api/seo/ai-crawlers
 *
 * Checks whether the creator's WordPress site lets the AI answer engines' crawlers
 * read it (robots.txt). If GPTBot / PerplexityBot / Google-Extended etc. are
 * blocked, the site's affiliate content can't be quoted in AI answers — a silent
 * AIO killer that a WP/SEO-plugin default or a copied robots.txt often causes.
 * Read-only, signed-in. See lib/ai-crawlers.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { checkAiCrawlers } from '@/lib/ai-crawlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const site = await getWordPressCredentials(supabase, user.id)
  const siteUrl = site?.wordpress_url
  if (!siteUrl) return NextResponse.json({ error: 'Connect a WordPress site first.', code: 'no_site' }, { status: 400 })

  const report = await checkAiCrawlers(siteUrl)
  return NextResponse.json({ ok: true, siteUrl, ...report })
}
