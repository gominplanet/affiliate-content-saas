// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/clip-factory/publish-kit — what a clip's description can carry on
// one platform, resolved before anything posts.
//   body: { platform, sourceVideoId?, product?, productName?, title?, hashtags?, writeUp? }
//
// Returns the product link (in the creator's link style, minted for that
// platform), where it came from, the full review, the link hub and the
// disclosure (lib/reel-caption resolveClipLinks). For YouTube it also writes a
// Short's title and a full tag set from the product and the clip, as a regular
// upload would have; when the writer cannot run, the clip's own title and tags
// are used and `youtube.note` says so. THE TAGS GO THROUGH REAL YOUTUBE
// SEARCHES (lib/youtube-search-tags), as every YouTube tags field does: what
// people type that is about this clip first, then the writer's that are.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { resolveClipLinks } from '@/lib/reel-caption'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { buildYouTubeShortTitle } from '@/lib/youtube-title'
import { buildYouTubeTags } from '@/lib/youtube-tags'
import type { ClipPlatform } from '@/lib/clip-description'
import { normalizeTier } from '@/lib/tier'
import { scrubTitle } from '@/lib/scrub'
import { hasVideoTools } from '@/lib/amazon-plan'
import { youtubeTagsFor, type TagResearch } from '@/lib/youtube-search-tags'
import { hashtagsFor } from '@/lib/hashtag-data'
import type { TagPlatform } from '@/lib/hashtag-engine'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-haiku-4-5-20251001'

/** Tags YouTube will take: phrases, each once, under its 500 character total. */
function cleanTags(raw: unknown): string[] {
  const out: string[] = []
  let total = 0
  for (const t of Array.isArray(raw) ? raw : []) {
    const v = String(t || '').replace(/^#+/, '').replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (v.length < 2 || v.length > 40 || out.includes(v)) continue
    if (total + v.length + 1 > 450) break
    out.push(v); total += v.length + 1
    if (out.length >= 15) break
  }
  return out
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    platform?: ClipPlatform; sourceVideoId?: string; product?: string; productName?: string
    title?: string; hashtags?: string[]; writeUp?: string
  }
  // Clip Factory publishing is Pro, as the uploads it leads to are.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(intRow?.tier)
  if (!hasVideoTools(tier)) return NextResponse.json({ error: 'Publishing from Clip Factory is part of the Pro plan.', tierRequired: 'pro' }, { status: 403 })

  const platform: ClipPlatform = ['tiktok', 'instagram', 'youtube', 'facebook'].includes(String(body.platform)) ? body.platform as ClipPlatform : 'tiktok'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const links = await resolveClipLinks(sb, user.id, {
    sourceVideoId: body.sourceVideoId, product: body.product, productName: body.productName, channel: platform,
  })

  let youtube: { title: string; tags: string[]; note: string | null; tagsResearch?: TagResearch & { searched: boolean } } | null = null
  if (platform === 'youtube') {
    const hook = String(body.title || '').trim() || 'New Short'
    const hashtags = Array.isArray(body.hashtags) ? body.hashtags.map(String) : []
    const fallback = { title: buildYouTubeShortTitle(hook, hashtags), tags: buildYouTubeTags(hashtags, hook) }
    try {
      const anthropic = createAnthropicClient()
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Write the YouTube metadata for a Short cut from a product review.

Clip hook: ${hook}
Clip caption: ${String(body.writeUp || '').slice(0, 600)}
Product: ${String(body.productName || '').slice(0, 200) || 'unknown'}
Full review video: ${links.videoTitle || 'unknown'}
Hashtags on the clip: ${hashtags.join(' ') || 'none'}

Rules:
- title: at most 90 characters, the hook or a sharper version of it, naming the product type. No price, no year, no clickbait claims the clip cannot back up, no hashtags in the title.
- tags: 12 to 15 search phrases a buyer would type: the product, its type, its brand if known, the problem it solves, "review" and comparison phrasings. Lowercase, no #, no prices, no years.

Reply with strict JSON only: {"title": "...", "tags": ["...", "..."]}`,
        }],
      })
      recordAnthropicUsage(msg, { userId: user.id, tier, feature: 'clip_youtube_metadata', model: MODEL })
      const text = ((msg.content?.[0] as { text?: string } | undefined)?.text ?? '').trim()
      let parsed: { title?: unknown; tags?: unknown } = {}
      try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch { parsed = {} }
      // scrubTitle: no year and the house rules, as every generated title.
      const title = scrubTitle(String(parsed.title || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim()).slice(0, 100)
      const tags = cleanTags(parsed.tags)
      youtube = title && tags.length >= 5
        ? { title, tags, note: null }
        : { ...fallback, note: 'The title and tags writer gave too little back, so the clip’s own title and tags are used. Edit them below.' }
    } catch (e) {
      youtube = { ...fallback, note: `The title and tags writer did not run (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}), so the clip’s own title and tags are used. Edit them below.` }
    }
    const research = await youtubeTagsFor(createAdminClient(), {
      videoTitle: links.videoTitle || hook, productName: String(body.productName || '') || null,
      text: `${hook}\n${String(body.writeUp || '').slice(0, 1500)}\n${hashtags.join(' ')}`, writer: youtube.tags,
    })
    if (research.tags.length) youtube = { ...youtube, tags: research.tags, tagsResearch: research }
    if (!research.searched) youtube = { ...youtube, note: [youtube.note, 'YouTube’s search box did not answer in time, so the tags are the ones about this clip, not yet checked against real searches.'].filter(Boolean).join(' ') }
  }

  // THIS PLATFORM'S HASHTAGS, picked by the engine for it (Seb, 2026-10-20:
  // "anything that MVP creates as far as tagging and hashtags ... runs through
  // this kind of engine"): researched live, by its own rule and counts. The
  // clip's tags (picked once for the Short) are suggestions. Null on failure,
  // and the panel keeps the clip's.
  const tagPlatform: TagPlatform = platform === 'youtube' ? 'youtube_short' : platform
  const clipTags = Array.isArray(body.hashtags) ? body.hashtags.map((t) => `#${String(t).replace(/^#+/, '')}`) : []
  const hashtags = await hashtagsFor({
    platform: tagPlatform,
    text: [String(body.productName || ''), String(body.title || ''), String(body.writeUp || '').slice(0, 1500), links.videoTitle || ''].filter(Boolean).join('\n'),
    brand: String(body.productName || '') || null,
    writer: clipTags,
    userId: user.id,
  }).then((p) => p.tags.map((t) => t.tag.replace(/^#/, ''))).catch(() => null)

  return NextResponse.json({ ok: true, platform, ...links, youtube, hashtags })
}
