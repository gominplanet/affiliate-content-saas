import { createAnthropicClient } from '@/lib/anthropic'
import type { AmazonProduct } from '@/services/amazon'

/**
 * Web-research agent for the campaign content engine.
 *
 * Unlike the YouTube pipeline (substance comes from the video transcript),
 * a campaign post has no source material — so we research the open web.
 * Uses Claude Sonnet with the built-in `web_search` server tool (no extra
 * API key, Claude runs the searches + synthesizes in one call) to produce
 * a structured research brief: the questions buyers actually ask, the
 * problems the product solves, real objections/complaints, and how it
 * compares to alternatives.
 *
 * Returns a markdown brief (consumed by the blog prompt) plus the source
 * URLs Claude cited, so we can show provenance later if we want.
 */

export interface ResearchBrief {
  brief: string
  citations: string[]
}

export async function researchProduct(product: AmazonProduct): Promise<ResearchBrief> {
  const client = createAnthropicClient()

  const productContext = [
    `Product: ${product.title}`,
    product.price ? `Price: ${product.price}` : '',
    product.rating ? `Amazon rating: ${product.rating}` : '',
    product.bullets.length ? `Key features:\n${product.bullets.map(b => `- ${b}`).join('\n')}` : '',
    product.description ? `Description: ${product.description.slice(0, 800)}` : '',
  ].filter(Boolean).join('\n')

  const prompt = `You are a product research analyst preparing a brief for an affiliate review writer.

Research this product thoroughly using web search. Run multiple searches — the product by name, "<product> review", "<product> problems", "<product> vs", "is <product> worth it", relevant Reddit / forum threads, and the underlying use-case or problem category.

${productContext}

Produce a RESEARCH BRIEF in markdown with exactly these sections:

## What buyers actually ask
8–12 real questions people ask before buying this (or this category). Phrase them the way a real shopper would search/ask. These become the FAQ.

## Problems it solves
The concrete pain points / frustrations this product addresses. Be specific about the "before" state — what's annoying/broken without it.

## Honest objections & complaints
Real downsides, common complaints, who it's NOT for. Pulled from reviews/forums, not invented. A trustworthy review acknowledges these.

## How it compares
The main alternatives buyers weigh it against and the practical trade-offs (price, durability, ease, etc.).

## Key facts worth citing
Specs, numbers, or claims found in research that strengthen the review's credibility.

Rules:
- Ground every section in what you actually found via search. If something is thin, say so rather than padding.
- No marketing fluff in the brief itself — it's an internal working document.
- Keep the whole brief under ~900 words.

Return ONLY the markdown brief.`

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [
      // Server-side web search tool — Claude runs the queries itself.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: 'web_search_20250305', name: 'web_search', max_uses: 6 } as any,
    ],
    messages: [{ role: 'user', content: prompt }],
  })

  // The response interleaves tool-use / search-result / text blocks. We want
  // the final synthesized text; concatenate any text blocks. Citation URLs
  // come from web_search_tool_result blocks.
  let brief = ''
  const citations = new Set<string>()
  for (const block of msg.content) {
    if (block.type === 'text') {
      brief += block.text
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyBlock = block as any
    if (anyBlock.type === 'web_search_tool_result' && Array.isArray(anyBlock.content)) {
      for (const r of anyBlock.content) {
        if (r?.url) citations.add(r.url)
      }
    }
  }

  brief = brief.trim()
  if (!brief) {
    throw new Error('Research agent returned no brief — web search may have failed')
  }

  return { brief, citations: Array.from(citations).slice(0, 20) }
}
