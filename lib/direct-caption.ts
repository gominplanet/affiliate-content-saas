// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Caption + hashtag generator for DIRECT vertical pushes — i.e. when the
// creator posts a Short straight to TikTok / Instagram without first
// turning it into a blog post.
//
// Inputs:
//   * The YouTube video the Short comes from (title + description)
//   * The creator's brand profile (niches, words to avoid, affiliate
//     disclaimer)
//   * The target platform (TikTok and Instagram have different hashtag
//     etiquette + caption-length sweet spots)
//
// Output:
//   * A caption block ready to paste into the publish UI:
//       <hook line>
//       <1-2 lines of value>
//
//       <hashtags, platform-tuned>
//
//       <affiliate disclaimer>
//
// Uses Haiku (claude-haiku-4-5-20251001) — captions are short, the
// inference budget is tiny, and the freshness matters more than depth.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import type { Tier } from '@/lib/tier'

const MODEL = 'claude-haiku-4-5-20251001'

export type CaptionPlatform = 'tiktok' | 'instagram'

export interface DirectCaptionInput {
  /** YouTube video title — the strongest signal for what the Short is about. */
  videoTitle: string
  /** YouTube video description — second-strongest signal. Often carries the
   *  affiliate URL + structured product info the creator already wrote. */
  videoDescription: string
  /** Brand niches from brand_profiles. Up to 4 used. Drives the niche
   *  hashtags. */
  niches: string[]
  /** Creator's banned-word list — applied verbatim to the output. */
  wordsToAvoid: string[]
  /** Affiliate disclaimer from brand_profiles. If empty we fall back to a
   *  neutral default. Surfaced verbatim at the END of the caption (TikTok
   *  + IG both require it for affiliate content). */
  affiliateDisclaimer: string
  platform: CaptionPlatform
}

export interface DirectCaptionResult {
  /** Full ready-to-post caption — hook + value + hashtags + disclaimer.
   *  Already capped per-platform (TikTok 2200, IG 2200). */
  caption: string
  /** Hashtags only — exposed separately so the UI can render them as
   *  pills if it wants. They're ALSO embedded in `caption` already. */
  hashtags: string[]
  /** First line of the caption — used as the YouTube-Short-style hook
   *  preview if the UI surfaces a separate hook field. */
  hook: string
}

/** Per-platform constraints — captions are tuned to each platform's
 *  conventions, not just truncated to the same length. */
const PLATFORM_RULES: Record<CaptionPlatform, {
  charCap: number
  hashtagCount: number
  voice: string
}> = {
  tiktok: {
    charCap: 2200,
    // TikTok's algorithm favors 3-5 specific niche hashtags; more is
    // treated as spam-y. We aim for 4.
    hashtagCount: 4,
    voice: 'TikTok: punchy, hook in the first line, conversational, ONE clear takeaway. No "link in bio" mentions — the description handles links separately.',
  },
  instagram: {
    charCap: 2200,
    // Instagram tolerates more hashtags. We aim for 8 — niche heavy.
    hashtagCount: 8,
    voice: 'Instagram Reels: friendly, build to the value, drop the takeaway. NO "link in bio" mentions — IG already has a Link Sticker for Stories.',
  },
}

/** Hard ban list applied to the final caption regardless of what the
 *  model produces — same family blocked across blog + script + here. */
const BANNED_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:honestly|honesty|honest)\b/gi, ''],
  [/\b(?:link in (?:the )?(?:description|bio|below))\b[\s,.!]*/gi, ''],
  [/\b(?:smash (?:that|the) like|hit (?:that|the) bell|don['’]t forget to (?:like|subscribe))\b[\s,.!]*/gi, ''],
  [/\b(?:game[- ]changer|mind[- ]blowing|next[- ]level|absolute banger)\b/gi, 'really good'],
]

function scrub(s: string): string {
  let out = s
  for (const [pat, replacement] of BANNED_PATTERNS) out = out.replace(pat, replacement)
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim()
}

/** Generate a platform-tuned caption from a vertical Short.
 *
 *  Records Anthropic token usage tagged with the platform so the AI cost
 *  dashboard can see which surface burned what.
 */
export async function generateDirectCaption(
  input: DirectCaptionInput,
  ctx: { userId: string; tier: Tier },
): Promise<DirectCaptionResult> {
  const rules = PLATFORM_RULES[input.platform]
  const platformLabel = input.platform === 'tiktok' ? 'TikTok' : 'Instagram Reels'

  const disclaimer = input.affiliateDisclaimer.trim() ||
    'Some links may be affiliate links — I may earn a small commission at no cost to you.'

  const prompt = `You're writing a caption for a vertical Short the creator wants to post to ${platformLabel} RIGHT NOW (no blog post involved). It needs to:

1. Open with a punchy hook line — under 80 characters — that lifts the most clickable angle from the video's title.
2. Follow with 1-2 lines of value or context. Concrete, specific. Pull from the description if useful — but never invent product details, specs, or numbers that aren't in the title or description.
3. Then a blank line, then ${rules.hashtagCount} hashtags on one line:
   - 2-3 niche hashtags tied to ${input.niches.slice(0, 4).join(', ') || 'the topic'}
   - 1-2 product/category hashtags pulled from the title
   - 1 general engagement hashtag appropriate for ${platformLabel}
   - All in #lowercase, no spaces inside the tag, no duplicate hashtags
4. Then a blank line, then the affiliate disclaimer EXACTLY as given:
   ${disclaimer}

VOICE: ${rules.voice}

HARD BANS:
- The word "honest", "honestly", or "honesty" in any form.
- Mentions of "link in description / bio / below" — both platforms have other surfaces for links.
- "Smash the like", "hit the bell", "don't forget to subscribe" — engagement-bait sign-offs.
- Hype clichés: "game-changer", "mind-blowing", "next-level", "absolute banger".
${input.wordsToAvoid.length ? `- Creator's own banned words: ${input.wordsToAvoid.slice(0, 30).join(', ')}` : ''}

VIDEO TITLE
${input.videoTitle}

VIDEO DESCRIPTION
${input.videoDescription.slice(0, 1500)}

Return ONLY a single JSON object with NO prose around it, shaped EXACTLY:

{
  "hook": "<the first line — punchy opener>",
  "body": "<1-2 lines of value>",
  "hashtags": ["#tag1", "#tag2", "..."]
}`

  let parsed: { hook?: string; body?: string; hashtags?: string[] }
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, {
      userId: ctx.userId,
      tier: ctx.tier,
      feature: `direct_caption_${input.platform}`,
      model: MODEL,
    })
    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Model returned no JSON')
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    // Fallback: a basic, deterministic caption from the title + niches.
    // Better than nothing if the model errors out.
    const niche = input.niches[0] || 'review'
    parsed = {
      hook: input.videoTitle,
      body: '',
      hashtags: [
        `#${niche.toLowerCase().replace(/[^a-z0-9]+/g, '')}`,
        `#review`,
        `#${input.platform === 'tiktok' ? 'tiktokmademebuyit' : 'reels'}`,
      ],
    }
  }

  const hook = scrub((parsed.hook || '').slice(0, 200))
  const body = scrub((parsed.body || '').slice(0, 400))
  const hashtags = (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
    .map(t => String(t).trim())
    .filter(Boolean)
    .map(t => (t.startsWith('#') ? t : `#${t}`))
    .map(t => t.replace(/\s+/g, ''))
    .filter((t, i, arr) => arr.indexOf(t) === i)              // dedupe
    .slice(0, rules.hashtagCount)

  // Final assembly. Capped to the platform char limit just in case.
  const fullCaption = [
    hook,
    body,
    hashtags.join(' '),
    disclaimer,
  ].filter(Boolean).join('\n\n').slice(0, rules.charCap)

  return {
    caption: fullCaption,
    hashtags,
    hook,
  }
}
