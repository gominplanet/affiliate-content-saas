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
- 2 OR 3 WORDS MAXIMUM. Hard ceiling — 4 words is a fail. Big poppy thumbnails (vidIQ / MrBeast / Smart-Toaster style) live on 2–3 huge words; longer phrases render tiny on a 1280×720 canvas. ALL CAPS.
- Every word EARNS its slot. NO filler — no articles (A / AN / THE), no copulas (IS / ARE / WAS), no pronouns (IT / I / WE / YOU / MY), no connectors (AND / OR / BUT / FOR / TO / OF / WITH / IN / ON).
- MUST mention or directly evoke this exact product/topic. The product noun should appear in at least 3 of the ${count} options (e.g. "ROCKER" for a swivel rocker chair, "WINE BAG" for a wine protector). A reader who has never seen the video should be able to guess what it's about.
- DIFFERENT angles across the ${count} — product callout, curiosity, value, comparison, surprise. Mix product-naming titles with one or two punchy reactions ("WORTH IT?", "WHOA").
- No spammy hype. NEVER use any of: AMAZING / INSANE / INCREDIBLE / GAME-CHANGER. And NEVER use any form of "honest" (HONEST, HONESTLY, HONESTY) — that word is permanently banned everywhere in MVP.
- No invented results, no time-based brags ("after 30 days", "lost 10 lbs", "before/after").
- No retailer / brand-name claims you can't verify from the title.

EXAMPLES — for a video about a "wine bottle protector bag for travel":
GOOD (2-3 words, product-evoking): "WINE BAG?", "TRAVEL WINE", "BREAK-PROOF!", "WORTH PACKING?", "FLY WITH WINE"
BAD (too long — AVOID): "BREAK-PROOF WINE TRAVEL", "WINE CHILLER OR PROTECTOR?", "FLY HOME WITH WINE"
BAD (generic slop — AVOID): "I WASN'T READY", "GAME CHANGER!", "MUST HAVE!"

EXAMPLES — for a "swivel rocker patio chair":
GOOD: "ROCKER WIN", "PATIO MVP", "CHAIR ALERT!", "SWIVEL TEST", "DOES IT RECLINE?"
BAD (too long): "SWIVEL ROCKER PATIO CHAIR TEST", "WHY I'M NEVER LEAVING THIS CHAIR", "DOES THIS PATIO CHAIR ACTUALLY RECLINE?"

COUNT THE WORDS BEFORE YOU RETURN — anything over 3 words must be cut.

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
    // We then enforce the 2–3 WORD rule client-side too — the AI does NOT
    // reliably count words, so anything 4+ words gets trimmed to its first 3.
    const FILLER = new Set([
      'A','AN','THE','IS','ARE','WAS','WERE','BE','BEEN','BEING',
      'IT','THIS','THAT','THESE','THOSE','I','WE','YOU','THEY','HE','SHE',
      'OF','FOR','TO','IN','ON','AT','BY','WITH','FROM','AS','AND','OR','BUT',
      'MY','OUR','YOUR','THEIR','HIS','HER',
      'JUST','VERY','REALLY','SO','TOO','ALSO','ABOUT','LIKE','THAN','HOW','MUCH',
    ])
    const trimToThreeWords = (t: string): string => {
      let ws = t.split(/\s+/).filter(Boolean)
      if (ws.length > 3) {
        const keepers = ws.filter(w => !FILLER.has(w.replace(/[^A-Z']+/g, '')))
        if (keepers.length >= 2) ws = keepers
      }
      if (ws.length > 3) ws = ws.slice(0, 3)
      return ws.join(' ')
    }
    const titles = arr
      .map(t => String(t || '').trim().replace(/^["']|["']$/g, ''))
      .map(t => scrubBanned(t).toUpperCase().trim())
      .map(trimToThreeWords)
      .filter(t => t.length >= 3 && t.length <= 40)
      .filter(t => t.split(/\s+/).filter(Boolean).length <= 3)
    if (titles.length === 0) throw new Error('empty title list')
    // Dedupe while preserving order — repeated outputs occasionally slip through.
    const seen = new Set<string>()
    const unique = titles.filter(t => seen.has(t) ? false : (seen.add(t), true))
    return unique.slice(0, count)
  } catch {
    // Safe deterministic fallback so the UI never hangs. Derived from the video
    // title so it stays at least loosely on-topic. All 2-3 words MAX to match
    // the new poppy-thumbnail rule — the fallback used to reintroduce 4-5
    // word titles ("BEFORE YOU BUY", "MY REAL TAKE") that the rest of the
    // pipeline was working hard to prevent.
    const FILLER_FB = new Set(['A','AN','THE','IS','ARE','WAS','WERE','OF','FOR','TO','IN','ON','WITH','AND','OR','MY','OUR','YOUR'])
    const base = (opts.videoTitle || 'this product').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim()
    const words = base.split(/\s+/).filter(w => w && !FILLER_FB.has(w))
    const noun = words[0] || 'THIS'
    const noun2 = words[1] || ''
    const productPair = noun2 ? `${noun} ${noun2}` : noun
    return [
      `${noun} TEST`,
      `WORTH IT?`,
      `${productPair} REVIEW`.split(/\s+/).slice(0, 3).join(' '),
      `${noun} WIN?`,
      `BIG MISTAKE?`,
    ].slice(0, count)
  }
}
