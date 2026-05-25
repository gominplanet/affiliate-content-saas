/**
 * Internal CTR-predictive scoring for thumbnails + titles.
 *
 * No external SEO/scoring account required (works for every user): a vision
 * pass (Claude Haiku) rates a generated thumbnail on the factors that actually
 * drive click-through, and a text pass rates a title. Used to auto-rank
 * variants and, optionally, gate publishing below a threshold. Best-effort —
 * returns null on any failure so it never blocks generation.
 */
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

const SCORE_MODEL = 'claude-haiku-4-5-20251001'

export interface ThumbnailScore {
  score: number // 0–100 overall
  breakdown: {
    faceEmotion: number
    contrast: number
    focalClarity: number
    textLegibility: number
    lowClutter: number
  }
  verdict: string
}

export interface TitleScore {
  score: number // 0–100
  verdict: string
}

interface Ctx { userId?: string | null; tier?: string | null }

function clamp100(n: unknown): number {
  const v = Math.round(Number(n) || 0)
  return Math.max(0, Math.min(100, v))
}

function firstJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) as Record<string, unknown> } catch { return null }
}

/** Fetch an image and return an Anthropic base64 image block (jpeg/png/webp). */
async function imageBlock(imageUrl: string): Promise<{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } } | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const media_type = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : 'image/jpeg'
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    return { type: 'image', source: { type: 'base64', media_type, data } }
  } catch {
    return null
  }
}

/**
 * Score a thumbnail (0–100) on CTR-predictive factors. `title` is the overlay
 * text that will sit on it (so legibility/fit can be judged). Returns null on
 * failure.
 */
export async function scoreThumbnail(imageUrl: string, opts: { title?: string; ctx?: Ctx } = {}): Promise<ThumbnailScore | null> {
  try {
    const img = await imageBlock(imageUrl)
    if (!img) return null
    const anthropic = createAnthropicClient()
    const titleLine = opts.title ? `The thumbnail will carry this overlay text: "${opts.title}". Judge whether it would sit legibly over this image.` : ''
    const msg = await anthropic.messages.create({
      model: SCORE_MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          img,
          {
            type: 'text',
            text: `You are a YouTube thumbnail expert predicting click-through rate. Score this thumbnail 0–100 on the factors that drive clicks.
${titleLine}
Rate each 0–100:
- faceEmotion: if a person is present, how expressive/eye-catching the face is (score 60 if no person is the focus)
- contrast: bold colour/value contrast that pops at small sizes
- focalClarity: one clear subject the eye lands on instantly
- textLegibility: room for large legible overlay text (high = clean space for text)
- lowClutter: minimal background distraction (high = clean)
Then an overall score weighting focalClarity + contrast + faceEmotion most.
Return ONLY JSON: {"score":N,"faceEmotion":N,"contrast":N,"focalClarity":N,"textLegibility":N,"lowClutter":N,"verdict":"one short sentence"}`,
          },
        ],
      }],
    })
    if (opts.ctx) recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'thumbnail_score', model: SCORE_MODEL })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const p = firstJson(text)
    if (!p) return null
    return {
      score: clamp100(p.score),
      breakdown: {
        faceEmotion: clamp100(p.faceEmotion),
        contrast: clamp100(p.contrast),
        focalClarity: clamp100(p.focalClarity),
        textLegibility: clamp100(p.textLegibility),
        lowClutter: clamp100(p.lowClutter),
      },
      verdict: String(p.verdict || '').slice(0, 200),
    }
  } catch {
    return null
  }
}

/**
 * Score several thumbnail variants and return them ordered best-first with
 * their scores attached. Scores run in parallel. Unscored variants sort last.
 */
export async function rankThumbnails(
  urls: string[],
  opts: { title?: string; ctx?: Ctx } = {},
): Promise<Array<{ url: string; score: ThumbnailScore | null }>> {
  const scored = await Promise.all(urls.map(async url => ({ url, score: await scoreThumbnail(url, opts) })))
  return scored.sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1))
}

/**
 * Score a YouTube/video title (0–100) for click-through: curiosity, clarity,
 * primary keyword near the front, ≤~60 chars, no hype/clickbait. Text-only.
 */
export async function scoreTitle(title: string, opts: { keyword?: string; ctx?: Ctx } = {}): Promise<TitleScore | null> {
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: SCORE_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Score this YouTube/blog title 0–100 for click-through potential.
TITLE: "${title}"
${opts.keyword ? `Target keyword: "${opts.keyword}" (reward it appearing near the front).` : ''}
Reward: curiosity/benefit, clarity, ≤60 chars, specificity. Penalize: vague, keyword-stuffed, hypey/clickbait, the word "honest".
Return ONLY JSON: {"score":N,"verdict":"one short sentence"}`,
      }],
    })
    if (opts.ctx) recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'title_score', model: SCORE_MODEL })
    const text = ((msg.content[0] as { type: string; text: string }).text || '').trim()
    const p = firstJson(text)
    if (!p) return null
    return { score: clamp100(p.score), verdict: String(p.verdict || '').slice(0, 200) }
  } catch {
    return null
  }
}
