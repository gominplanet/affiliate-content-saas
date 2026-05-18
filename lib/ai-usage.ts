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

type Pricing = { in: number; out: number } // $ per 1M tokens

export const PRICING: Record<string, Pricing> = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-opus-4-7': { in: 15, out: 75 },
  'dall-e-3': { in: 0, out: 0 },
}
export const WEB_SEARCH_COST = 0.01 // $ per search (Anthropic server tool)
export const IMAGE_COST = 0.04      // $ per generated image (Gemini Flash Image / DALL·E ≈)

export interface UsageRow {
  model: string
  input_tokens: number
  output_tokens: number
  web_searches: number
  images: number
}

export function costOf(r: UsageRow): number {
  const p = PRICING[r.model] ?? { in: 0, out: 0 }
  return (
    (r.input_tokens / 1e6) * p.in +
    (r.output_tokens / 1e6) * p.out +
    r.web_searches * WEB_SEARCH_COST +
    r.images * IMAGE_COST
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
