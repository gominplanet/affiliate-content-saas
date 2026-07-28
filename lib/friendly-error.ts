// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Turns ANY internal/thrown error into a safe, user-facing message. Users must
// never see raw provider errors, HTTP/JSON blobs, billing/credit wording, or the
// names of the lateral services we run on (Anthropic, Cloudinary, Keepa,
// Geniuslink, Supabase, etc.). Log the real error server-side; show this.

export function toUserMessage(
  err: unknown,
  fallback = 'Something went wrong on our end. Please try again in a moment.',
): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()

  // AI writing capacity / credits / quota / rate limits / provider hiccups →
  // one neutral message. NEVER surfaces "credit", "billing", or a provider name.
  if (/credit|balance|billing|payment|quota|insufficient|too low|rate.?limit|\b429\b|overloaded|capacity|anthropic|openai|api key|unauthorized|\b401\b|\b403\b/.test(raw)) {
    return 'Our content service is busy right now. Please try again in a minute.'
  }
  // Timeouts / network.
  if (/timeout|timed out|econn|enotfound|network|fetch failed|socket|aborted/.test(raw)) {
    return 'That took too long to complete. Please try again in a moment.'
  }
  return fallback
}
