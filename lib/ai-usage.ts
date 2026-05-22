/**
 * AI cost telemetry. Every billable model call records a row in
 * `ai_usage` (service-role, fire-and-forget — logging must never slow
 * or break a generation). The admin cost dashboard reads it back.
 *
 * Pricing is approximate public list pricing (USD per 1M tokens unless
 * noted). Update PRICING if vendor pricing changes — historical rows
 * keep their token counts, so re-pricing is just recomputation.
 */
import { createAdminClient } from '@/lib/supabase/admin'

interface Pricing {
  /** USD per 1M input tokens (text/chat models). */
  in: number
  /** USD per 1M output tokens (text/chat models). */
  out: number
  /** USD per generated image (image models). Falls back to
   *  IMAGE_COST_FALLBACK if a model with images > 0 isn't in PRICING. */
  imageCost?: number
}

// All pricing is approximate list price. Update here when a vendor
// changes prices; historical rows keep their raw token counts so
// re-pricing is just recomputation against the new map.
export const PRICING: Record<string, Pricing> = {
  // ── Anthropic ──────────────────────────────────────────────────────────
  'claude-sonnet-4-6':         { in: 3,  out: 15 },
  'claude-haiku-4-5-20251001': { in: 1,  out: 5  },
  'claude-opus-4-7':           { in: 15, out: 75 },

  // ── OpenAI — image generation (per-image flat rates) ──────────────────
  // dall-e-3 standard 1024x1024 = $0.04, 1024x1792 / 1792x1024 = $0.08
  'dall-e-3':      { in: 0, out: 0, imageCost: 0.04 },
  'dall-e-3-1792': { in: 0, out: 0, imageCost: 0.08 },
  // gpt-image-1 (multimodal, reference-based). Token-priced in reality; these
  // are approximate flat per-image costs for a 1536x1024 landscape image incl.
  // typical reference-image input tokens. high ≈ $0.19, medium ≈ $0.06.
  'gpt-image-1':        { in: 0, out: 0, imageCost: 0.19 },
  'gpt-image-1-medium': { in: 0, out: 0, imageCost: 0.06 },
  'gpt-image-1-low':    { in: 0, out: 0, imageCost: 0.02 },
  // gpt-image-2 — newer/most-capable image model. Approximate; update when
  // OpenAI publishes exact token rates. Falls back to IMAGE_COST_FALLBACK if
  // an unmapped variant is recorded.
  'gpt-image-2':        { in: 0, out: 0, imageCost: 0.19 },

  // ── OpenAI — text/chat (for fallbacks / future swaps) ─────────────────
  'gpt-4o':       { in: 2.5, out: 10  },
  'gpt-4o-mini':  { in: 0.15, out: 0.6 },
  'gpt-4.1':      { in: 2,   out: 8   },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },

  // ── Fal.ai — image generation (per-image flat rates) ──────────────────
  'fal-flux-pro-v1.1': { in: 0, out: 0, imageCost: 0.04 },
  'fal-flux-pro-kontext': { in: 0, out: 0, imageCost: 0.04 },
  // flux-lora is flux-dev + LoRA support. Slightly cheaper than Pro on
  // Fal's listed pricing; used when a user-trained face LoRA is loaded.
  'fal-flux-lora': { in: 0, out: 0, imageCost: 0.05 },
  // One-time LoRA training run — billed by Fal at a fixed per-job rate
  // regardless of how many images the job ingests.
  'fal-flux-lora-fast-training': { in: 0, out: 0, imageCost: 1.5 },
  // AuraSR 4x super-resolution — billed per compute-second ($0.001/s); a
  // single hero upscale runs ~10-15s, so ~$0.012/image (approximate).
  'fal-aura-sr': { in: 0, out: 0, imageCost: 0.012 },
  // Background removal (rembg) for the thumbnail creator cut-out. Cheap.
  'fal-rembg': { in: 0, out: 0, imageCost: 0.01 },

  // ── Google Gemini ──────────────────────────────────────────────────────
  'gemini-2.5-flash-image': { in: 0,     out: 0,    imageCost: 0.039 },
  'gemini-2.5-flash':       { in: 0.3,   out: 2.5  },
  'gemini-2.5-pro':         { in: 1.25,  out: 10   },
  'gemini-1.5-flash':       { in: 0.075, out: 0.3  },
  'gemini-1.5-pro':         { in: 1.25,  out: 5    },
}
export const WEB_SEARCH_COST = 0.01 // $ per search (Anthropic server tool)
/** Fallback per-image cost when an image model isn't in PRICING. */
export const IMAGE_COST_FALLBACK = 0.04

export interface UsageRow {
  model: string
  input_tokens: number
  output_tokens: number
  web_searches: number
  images: number
}

export function costOf(r: UsageRow): number {
  const p = PRICING[r.model] ?? { in: 0, out: 0 }
  const perImage = p.imageCost ?? (r.images > 0 ? IMAGE_COST_FALLBACK : 0)
  return (
    (r.input_tokens / 1e6) * p.in +
    (r.output_tokens / 1e6) * p.out +
    r.web_searches * WEB_SEARCH_COST +
    r.images * perImage
  )
}

/** Pull token + server-tool counts off an Anthropic message/finalMessage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usageFromAnthropic(msg: any): { input: number; output: number; webSearches: number } {
  const u = msg?.usage ?? {}
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  const output = u.output_tokens ?? 0
  const webSearches = u.server_tool_use?.web_search_requests ?? 0
  return { input, output, webSearches }
}

export interface RecordOpts {
  userId?: string | null
  tier?: string | null
  feature: string
  model: string
  input?: number
  output?: number
  webSearches?: number
  images?: number
}

/** Convenience wrapper for the common Anthropic case — pulls token /
 *  web-search counts off a message and records them in one call. */
export function recordAnthropicUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
  opts: { userId?: string | null; tier?: string | null; feature: string; model: string },
): void {
  const u = usageFromAnthropic(msg)
  recordUsage({
    userId: opts.userId,
    tier: opts.tier,
    feature: opts.feature,
    model: opts.model,
    input: u.input,
    output: u.output,
    webSearches: u.webSearches,
  })
}

/** Fire-and-forget. Never throws — a logging failure must not affect
 *  the user's generation. */
export function recordUsage(o: RecordOpts): void {
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (admin as any).from('ai_usage').insert({
      user_id: o.userId ?? null,
      tier: o.tier ?? null,
      feature: o.feature,
      model: o.model,
      input_tokens: Math.max(0, Math.round(o.input ?? 0)),
      output_tokens: Math.max(0, Math.round(o.output ?? 0)),
      web_searches: Math.max(0, Math.round(o.webSearches ?? 0)),
      images: Math.max(0, Math.round(o.images ?? 0)),
    }).then(undefined, () => {})
  } catch {
    /* no-op: telemetry must never break generation */
  }
}
