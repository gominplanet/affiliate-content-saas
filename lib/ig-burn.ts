// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Shared Instagram-Burner helpers — product research + Reel caption composition.
 * Used by both the single-burn route (/api/instagram/burn) and the batch cron
 * worker (/api/cron/process-burn-jobs) so the logic stays in one place.
 */
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { extractAsin, fetchAmazonProduct } from '@/services/amazon'
import { researchProductFromUrl } from '@/services/research'

export interface IgBurnCtx { userId: string; tier: string | null }

/** A pasted link that we deliberately do NOT scrape — TikTok actively bot-walls
 *  non-browser requests and scraping it breaks their ToS (and risks MVP's TikTok
 *  API approval). For these the creator supplies the product name instead. */
export function isUnscrapableShopLink(input: string): boolean {
  return /tiktok\.com|vt\.tiktok|tiktok\.shop|tiktokshop/i.test(input || '')
}

/** Resolve product context for the caption from a link + optional creator-supplied
 *  product name. Amazon ASIN → scrape the public listing; generic store URL →
 *  best-effort scrape; TikTok Shop link → name only (never scrape — see above);
 *  no link → just the name. The name is always folded in when present. */
export async function researchProductContext(
  productInput: string,
  ctx: IgBurnCtx,
  opts?: { productName?: string },
): Promise<string> {
  const input = (productInput || '').trim()
  const name = (opts?.productName || '').trim()

  // Amazon ASIN → richest context (title + bullets + description).
  const asin = extractAsin(input)
  if (asin) {
    try {
      const p = await fetchAmazonProduct(asin)
      const c = [p.title, (p.bullets || []).slice(0, 4).join(' · '), (p.description || '').slice(0, 400)].filter(Boolean).join('\n')
      if (c) return name ? `${name}\n${c}` : c
    } catch { /* fall through */ }
  }

  // TikTok links: don't scrape (bot wall + ToS). Lean on the creator's name.
  if (isUnscrapableShopLink(input)) return name || input

  // Generic store URL → best-effort public scrape, fall back to the name.
  if (/^https?:\/\//i.test(input)) {
    try { const r = await researchProductFromUrl(input, '', ctx); if (r) return name ? `${name}\n${r}` : r } catch { /* fall through */ }
    return name || input
  }

  // No link → use the supplied name (or whatever raw text was typed).
  return name || input
}

/** Compose a punchy IG Reel caption: hook + value + 3 niche hashtags + an #ad
 *  FTC disclosure. Best-effort — returns null on failure. */
export async function composeReelCaption(productContext: string, ctx: IgBurnCtx): Promise<string | null> {
  if (!productContext) return null
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Write an Instagram Reel caption promoting this product.

PRODUCT:
${productContext.slice(0, 1500)}

RULES:
- Strong hook on line 1 (max 7 words), then 1-2 short punchy value lines.
- Conversational creator voice, a couple of emojis max.
- Then EXACTLY 3 hashtags — SPECIFIC and niche to this product/topic (e.g. #coldbrewmaker), NOT generic spam (#amazonfinds, #musthave).
- Do NOT include any URL (not clickable on IG). You may say "link in bio".
- Never use the word "honest".
- Under 600 characters total.

Return ONLY the caption text + the 3 hashtags.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier, feature: 'ig_burn_caption', model: 'claude-haiku-4-5-20251001' })
    let text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    text = text.replace(/\bhonest(ly)?\b/gi, '').replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim()
    if (!/#ad\b/i.test(text)) text = `${text}\n\n#ad`
    return text || null
  } catch {
    return null
  }
}
