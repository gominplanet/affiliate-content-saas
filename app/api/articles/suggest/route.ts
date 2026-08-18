// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/articles/suggest
//   Suggest informational ARTICLE topics tailored to what the creator already
//   covers: their niche(s) + the products/topics in their existing reviews.
//   The point is topics that let them naturally reference their own reviews
//   (monetization) while publishing genuinely useful, non-salesy articles.
//
//   Cheap (one Haiku call, no web search, no publish). Same tier gate as the
//   Articles generator. Returns { suggestions: [{ topic, angle, keywords }] }.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier, TIERS } from '@/lib/tier'
import { spendGate } from '@/lib/ai-spend'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (TIERS[tier].articlesPerMonth === 0) {
    return NextResponse.json({ error: 'Articles is a Creator, Studio and Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const spendBlocked = await spendGate(user.id, tier)
  if (spendBlocked) return spendBlocked

  // What does this creator cover? Niche(s) + a sample of their published
  // reviews/guides (title + keyword). This grounds the suggestions in products
  // they can actually link back to.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: brand }, { data: posts }] = await Promise.all([
    (supabase as any).from('brand_profiles').select('niches').eq('user_id', user.id).maybeSingle(),
    (supabase as any).from('blog_posts')
      .select('title,seo_keyword')
      .eq('user_id', user.id)
      .in('post_type', ['review', 'comparison', 'guide'])
      .eq('status', 'published')
      .not('wordpress_url', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(40),
  ])

  const niches: string[] = Array.isArray(brand?.niches) ? brand.niches.filter(Boolean).slice(0, 8) : []
  const titles: string[] = Array.isArray(posts)
    ? posts.map((p: { title?: string | null }) => (p.title || '').trim()).filter(Boolean).slice(0, 40)
    : []

  if (titles.length === 0 && niches.length === 0) {
    return NextResponse.json({
      suggestions: [],
      empty: true,
      reason: 'Publish a few reviews or set your niche in Brand Profile first, then MVP can suggest article topics tied to what you cover.',
    })
  }

  const prompt = `You help an affiliate content creator brainstorm INFORMATIONAL ARTICLE topics (NOT product reviews and NOT listicles of products). These are genuinely useful, opinionated articles a reader would search on Google or ask an AI, on subjects CLOSE to the products the creator already reviews, so the creator can naturally reference their own reviews inside the piece.

${niches.length ? `THE CREATOR'S NICHE(S): ${niches.join(', ')}` : ''}
${titles.length ? `PRODUCTS / TOPICS THEY ALREADY REVIEW (use these to stay on-topic):\n${titles.map(t => `- ${t}`).join('\n')}` : ''}

Suggest 7 article topics. Each MUST:
- Be informational (how/why/what/comparisons of approaches, buying considerations, mistakes, maintenance, science, trends) — NOT "best X" product roundups.
- Sit close enough to their reviewed products that linking a review or two would feel natural.
- Be something with real search demand, phrased as a specific article headline (45-65 chars).

Return ONLY a JSON array, no prose, of exactly 7 objects:
[{"topic":"the article headline","angle":"one-sentence opinion/spin the creator could take","keywords":"2-3 comma-separated SEO keywords"}]`

  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'article_suggest', model: 'claude-haiku-4-5-20251001' })

    const raw = (msg.content[0] as { type: string; text?: string })?.text || ''
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    let parsed: Array<{ topic?: string; angle?: string; keywords?: string }> = []
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try { parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) } catch { parsed = [] }
    }
    const suggestions = parsed
      .filter(s => s && typeof s.topic === 'string' && s.topic.trim())
      .slice(0, 7)
      .map(s => ({
        topic: String(s.topic).trim().slice(0, 160),
        angle: String(s.angle || '').trim().slice(0, 300),
        keywords: String(s.keywords || '').trim().slice(0, 160),
      }))

    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[articles/suggest]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Couldn’t suggest topics just now. Please try again in a moment.') }, { status: 500 })
  }
}
