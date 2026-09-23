// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Turns ANY internal/thrown error into a safe, user-facing message. Users must
// never see raw provider errors, HTTP/JSON blobs, billing/credit wording, or the
// names of the lateral services we run on (Anthropic, Cloudinary, Keepa,
// Geniuslink, Supabase, etc.). Log the real error server-side; show this.

/**
 * An error whose message WE wrote for the person reading the screen.
 *
 * WHY THIS EXISTS. toUserMessage below replaces every message it does not
 * recognise with a generic fallback, which is right for a provider error and
 * destructive for a sentence we authored on purpose. Pasting a storefront link
 * into the idea-list reader threw "That doesn't look like an Amazon idea-list
 * link (amazon.com/shop/…/list/…)", which names the problem exactly, and the
 * screen said "Could not read that list. Double-check the link" instead: the
 * link was fine, it was the wrong kind of link, and the advice sent somebody
 * to re-examine the one thing that was not wrong.
 *
 * The bot-check message was worse. It says "use the SCOUT extension instead",
 * which is the actual answer, and it was replaced by a generic line that
 * suggests SCOUT for every cause including the ones SCOUT cannot help with.
 *
 * OPT-IN, DELIBERATELY. Forty-two call sites use toUserMessage and the whole
 * point of the file is that a raw provider error never reaches a user. So
 * nothing changes for any of them: only a message thrown as this class passes
 * through, and throwing one is a statement that it was written to be read.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

export function toUserMessage(
  err: unknown,
  fallback = 'Something went wrong on our end. Please try again in a moment.',
): string {
  // BEFORE the pattern matching below, not after. One of these sentences is
  // "Amazon returned 403 for that list", and the provider rules would turn
  // that into "our content service is busy", which blames us for Amazon and
  // tells the reader to wait for something that will never change on its own.
  if (err instanceof UserFacingError && err.message.trim()) return err.message

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
