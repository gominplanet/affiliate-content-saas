// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Deterministic post-write scrubber for the voice-betrayal patterns the model
// keeps slipping past the prompt rules. Belt-and-suspenders: the prompt forbids
// these explicitly (see services/claude/index.ts rule 8 + the BANNED WORDS list),
// but LLMs are not 100% reliable, so any draft is also passed through here as a
// last line of defense before publish.
//
// The patterns flagged by the user (2026-05-28) — these read as a stranger
// analysing the author's own video instead of the author speaking — fall into
// two buckets:
//   1) PHRASE LEAD-INS we can rewrite by dropping the lead-in and keeping the
//      sentence body. "From what we see in the video, the design feels…" →
//      "The design feels…".
//   2) FILLER SENTENCES that exist only to pad length, where the simplest fix
//      is to drop the whole containing paragraph. "Watch the full video before
//      deciding. We say this about everything but…" — these paragraphs add
//      nothing once the video is already embedded at the top of the post.

/** Phrases we rewrite in place (drop the lead-in, keep the rest of the
 *  sentence). Match must include trailing comma + space so the cut leaves
 *  clean grammar. */
const PHRASE_REWRITES: Array<[RegExp, string]> = [
  // "From what we see in the video, X." → "X."
  [/\bfrom what (?:we|i)(?: can)? see in the video,?\s*/gi, ''],
  // "Based on what we can see in the video, X" → "X"
  [/\bbased on what (?:we|i)(?: can)? see in the video,?\s*/gi, ''],
  // "What we see in the video is X" → "X" (rare grammar, but happens)
  [/\bwhat (?:we|i) see in the video (?:is|are|was|were)\s+/gi, ''],
  // "the video walks through X" / "the video notes X" → drop the lead-in
  [/\bthe video (?:walks through|notes|displays|suggests|implies|says|tells us)\s+/gi, ''],
]

/** Patterns whose mere presence in a paragraph means the WHOLE paragraph is
 *  filler / meta — drop the paragraph entirely. Word-boundaries are used so we
 *  don't false-positive on a legitimate sentence that incidentally mentions
 *  "video". */
const PARAGRAPH_KILLERS: RegExp[] = [
  /\bwatch the full video\b/i,
  /\bsee it in motion\b/i,
  /\bwe say this about everything\b/i,
  /\bwithout an accompanying transcript\b/i,
  /\b(?:the )?video gives(?: you)? the full visual context\b/i,
  /\ba blog post can only take you so far\b/i,
  /\bwhat follows is built from what(?:'s| is) shown\b/i,
  /\bgrounded in what (?:we|i) can actually see and verify\b/i,
  /\bthe video title frames\b/i,
  /^\s*note:?\s+this video was filmed without/i,
]

export interface VoiceScrubReport {
  /** The scrubbed content. */
  content: string
  /** Paragraphs we dropped wholesale (they matched a killer pattern). */
  paragraphsRemoved: number
  /** Phrase-level rewrites we applied within otherwise-good paragraphs. */
  phrasesRewritten: number
}

/**
 * Scrub voice-betrayal patterns from a blog post body. Safe on Gutenberg HTML —
 * we operate on `<p>…</p>` blocks (the surrounding `<!-- wp:paragraph -->`
 * comments wrap each `<p>` and stay paired naturally when the whole block is
 * dropped). Returns the cleaned content + counts so the route can log/report.
 */
export function scrubVoicePatterns(content: string): VoiceScrubReport {
  if (!content) return { content: '', paragraphsRemoved: 0, phrasesRewritten: 0 }

  let paragraphsRemoved = 0
  let phrasesRewritten = 0

  // Match an optional <!-- wp:paragraph --> wrapper + the <p>…</p> block + the
  // optional closing comment. If the <p> contains a killer pattern, drop the
  // entire wp:paragraph block so we don't leave dangling comment markers.
  const PARA_BLOCK = /(?:<!--\s*wp:paragraph[^>]*-->\s*)?<p\b[^>]*>([\s\S]*?)<\/p>(?:\s*<!--\s*\/wp:paragraph\s*-->)?/gi

  const scrubbed = content.replace(PARA_BLOCK, (match, inner: string) => {
    // 1) Paragraph-level killers — drop the whole block.
    if (PARAGRAPH_KILLERS.some(re => re.test(inner))) {
      paragraphsRemoved++
      return ''
    }
    // 2) Phrase rewrites in place.
    let rewritten = inner
    let hits = 0
    for (const [re, repl] of PHRASE_REWRITES) {
      const m = rewritten.match(re)
      if (m) {
        rewritten = rewritten.replace(re, repl)
        hits += m.length
      }
    }
    if (hits === 0) return match
    phrasesRewritten += hits
    // Re-capitalise the new first letter if the dropped lead-in left lowercase.
    rewritten = rewritten.replace(/^(\s*)([a-z])/, (_, ws: string, c: string) => ws + c.toUpperCase())
    // Tidy double spaces + orphan whitespace introduced by the cut.
    rewritten = rewritten.replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '')
    return match.replace(inner, rewritten)
  })

  // Tidy: collapse any consecutive blank lines the paragraph drops created.
  const tidied = scrubbed.replace(/\n{3,}/g, '\n\n')

  return { content: tidied, paragraphsRemoved, phrasesRewritten }
}
