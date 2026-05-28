// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Pre-generation thumbnail title options.
//
// The existing `generateHooks` (route-local in generate-thumbnail) deliberately
// produces GENERIC, reusable thumbnail phrases ("I Wasn't Ready For This",
// "Why Does This Exist?") because those happen to maximise CTR. But that's
// also what the user calls "slop" — they want the title picker to surface
// options that clearly pertain to THIS specific product/video so the creator
// (who knows the niche) can pick the best fit.
//
// This helper does the opposite: it reads the video title + description (and
// the ASIN if we have it) and produces titles that name or evoke the actual
// product/topic — different angles each (curiosity, value, comparison,
// problem, result). One Haiku call, ~$0.001.

import { createAnthropicClient } from './anthropic'
import { recordAnthropicUsage } from './ai-usage'
import { scrubBanned } from './scrub'

export interface TitleOptionsCtx {
  userId: string | null
  tier: string | null
}

/**
 * Returns up to `count` distinct, product/video-specific thumbnail title
 * options. Falls back to a small set of safe defaults if Claude fails (so the
 * UI never gets stuck loading forever).
 */
export async function generateProductTitleOptions(opts: {
  videoTitle: string
  /** Free-form description. Truncated server-side; first ~500 chars carry the
   *  product info from creator preambles + affiliate links. */
  videoDescription?: string | null
  /** Amazon ASIN if we have it — a strong product-identity signal. */
  asin?: string | null
  count?: number
  ctx: TitleOptionsCtx
}): Promise<string[]> {
  const count = Math.max(3, Math.min(8, opts.count ?? 5))
  const description = (opts.videoDescription || '').slice(0, 500).trim()
  const asin = (opts.asin || '').trim()

  const prompt = `Read the video below and write ${count} DISTINCT, scroll-stopping YouTube thumbnail titles. Every title MUST clearly pertain to THIS specific product/video — never a generic phrase that could be slapped on any random video.

VIDEO TITLE: "${opts.videoTitle}"
${description ? `DESCRIPTION (first 500 chars): "${description}"` : ''}
${asin ? `Product ASIN: ${asin}` : ''}

RULES (each title):
- 2 to 6 words. Complete punchy phrase. ALL CAPS.
- MUST mention or directly evoke this exact product/topic. A reader who has never seen the video should be able to guess what it's about from the title alone.
- DIFFERENT angles across the ${count} — e.g. curiosity, problem, value/price, comparison, transformation/result, surprise.
- No spammy hype. NEVER use any of: AMAZING / INSANE / INCREDIBLE / GAME-CHANGER. And NEVER use any form of "honest" (HONEST, HONESTLY, HONESTY) — that word is permanently banned everywhere in MVP, no exceptions.
- No invented results, no time-based brags ("after 30 days", "lost 10 lbs", "before/after").
- No retailer / brand-name claims you can't verify from the title.

EXAMPLES — for a video about a "wine bottle protector bag for travel":
GOOD (specific): "WINE IN A BAG?", "BREAK-PROOF WINE TRAVEL", "FLY HOME WITH WINE", "WINE CHILLER OR PROTECTOR?", "WORTH PACKING?"
BAD (generic slop — AVOID): "I WASN'T READY", "WHY DOES THIS EXIST?", "GAME CHANGER!", "MIND BLOWN", "MUST HAVE!"

Return ONLY a JSON array of exactly ${count} strings. No prose around it.`

  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 240,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, {
      userId: opts.ctx.userId, tier: opts.ctx.tier,
      feature: 'yt_thumb_title_options', model: 'claude-haiku-4-5-20251001',
    })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const m = text.match(/\[[\s\S]*\]/)
    if (!m) throw new Error('no JSON array in response')
    const arr = JSON.parse(m[0]) as unknown[]
    // Belt-and-suspenders: even with the explicit ban in the prompt, the model
    // sometimes slips "HONESTLY" / "HONEST" through. scrubBanned removes those
    // words and tidies the surrounding whitespace, so "TESTED HONESTLY" → "TESTED".
    // Anything that ends up too short / empty post-scrub gets dropped.
    const titles = arr
      .map(t => String(t || '').trim().replace(/^["']|["']$/g, ''))
      .map(t => scrubBanned(t).toUpperCase().trim())
      .filter(t => t.length >= 4 && t.length <= 60)
    if (titles.length === 0) throw new Error('empty title list')
    // Dedupe while preserving order — repeated outputs occasionally slip through.
    const seen = new Set<string>()
    const unique = titles.filter(t => seen.has(t) ? false : (seen.add(t), true))
    return unique.slice(0, count)
  } catch {
    // Safe deterministic fallback so the UI never hangs. Derived from the video
    // title so it stays at least loosely on-topic, but flagged as fallback to
    // the caller via the absence of variety — pragmatic, not pretty.
    const base = (opts.videoTitle || 'this product').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 30)
    const stub = base || 'THIS PRODUCT'
    return [
      `${stub} REVIEW`,
      `IS IT WORTH IT?`,
      `BEFORE YOU BUY`,
      `MY REAL TAKE`,
      `${stub.split(' ')[0]} — WATCH FIRST`,
    ].slice(0, count)
  }
}
