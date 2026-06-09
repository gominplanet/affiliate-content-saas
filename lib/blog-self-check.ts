// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Blog post self-check pass.
//
// After Sonnet writes the article, this helper sends the rendered HTML to
// Haiku and asks it to find any sentence that still violates the catalogue-
// level style rules — tic phrases, em-dash headings, crescendo conclusions,
// "like genuinely ___" compounds. Each violation is returned with a
// suggested rewrite, applied via plain string-replace, and the cleaned
// content is returned to the caller.
//
// Why this exists:
//   The writing-time prompt is ~640 lines and explicitly bans these
//   patterns, but model drift on long generations still lets the
//   occasional tic slip through. A targeted Haiku pass costs ~$0.001
//   per post and catches the leak. Catching them HERE — before WP
//   upload — beats catching them on the live blog and having to hit
//   Refresh-images / regenerate.
//
// Defensive principle:
//   ANY failure in the self-check ships the original content unchanged.
//   This is BEST-EFFORT polish, not a hard gate. A Haiku outage, a
//   malformed response, or a violation Haiku invents must NEVER block
//   the post from publishing.
//
// What it does NOT do:
//   - Substantive editing (no rewriting paragraphs, restructuring, fact-
//     checking). The writing-time prompt does that work.
//   - Catching every possible rule violation. This is a targeted sweep
//     against the 6-7 catalogue-level tics the audit identified. If a
//     new tic emerges, add it here AND to the writing-time prompt.
//   - Modifying anything inside <style>, <script>, or HTML attribute
//     values — we operate on the rendered content as-is and rely on
//     Haiku to return whole-sentence pairs that won't collide with
//     markup. The string-replace is exact-match so partial matches
//     can't accidentally rewrite an HTML attribute.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

export interface BlogSelfCheckViolation {
  /** Which banned pattern fired (telemetry / debug only). */
  pattern: string
  /** The exact sentence in the original content that violates. */
  original: string
  /** Haiku's proposed rewrite — preserves meaning, cuts the tic. */
  suggested: string
  /** Whether the string-replace actually landed (false = original wasn't
   *  in the content verbatim, so we couldn't apply the fix). */
  applied: boolean
}

export interface BlogSelfCheckResult {
  content: string
  violations: BlogSelfCheckViolation[]
  /** Count of fixes that actually landed via string-replace. Distinct
   *  from violations.length because Haiku occasionally returns a
   *  "violation" whose `original` doesn't match the source verbatim
   *  (paraphrase, ellipsis, whitespace drift) and the replace becomes
   *  a no-op. */
  fixesApplied: number
  /** Count of product-specific concrete numbers detected in the body
   *  (dimensions, weights, durations, counts, percentages). Telemetry
   *  only — flagged in the log when below RULE 11's threshold of 3, but
   *  the post still ships. Use this to spot transcripts that genuinely
   *  lack measurable specs vs. posts where the model just didn't bother
   *  to surface them. */
  numbersDetected: number
}

/** Count product-specific numbers in the rendered HTML body.
 *
 *  The challenge: a published post contains many "numbers" that aren't
 *  product specs — the rating widget (4.4/5), the related-reviews
 *  sidebar (14-inch mattress, 20-inch lights), category links, byline
 *  dates. We scope to the actual body paragraphs by:
 *    1. Stripping all <style>/<script> blocks
 *    2. Dropping HTML tags entirely (text only)
 *    3. Dropping anything inside the .gr-rating-box / .gr-scorecard /
 *       related-reviews block heuristically
 *    4. Counting numeric occurrences that look spec-like — preceded or
 *       followed by a unit (inches, lbs, oz, ft, mm, cm, hours, mins,
 *       lumens, watts, mAh, %, $, ° etc.) OR appearing in obvious
 *       count constructions ("7 compartments", "4 pockets", "12 hours").
 *
 *  Imperfect but better than zero — gives a directional signal so we
 *  can see which posts genuinely lack specs vs. which posts had specs
 *  but the model didn't surface them. */
function countProductSpecificNumbers(html: string): number {
  // Strip blocks we know shouldn't count toward the spec count.
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // The rating widget renders as .gr-rating-box / .gr-scorecard
    .replace(/<div[^>]*class="[^"]*gr-rating-box[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*gr-scorecard[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, '')
    // Related-reviews block heuristic
    .replace(/<h2[^>]*>Related reviews<\/h2>[\s\S]*?(?=<!-- wp:heading -->|$)/i, '')
    // Drop the affiliate disclaimer block (price/policy boilerplate)
    .replace(/<div[^>]*class="wp-block-group[^"]*has-background[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, '')
    // Drop the CTA card (product name spans containing numbers occasionally)
    .replace(/<div[^>]*class="[^"]*gr-cta-card[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, '')
  const text = stripped.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

  // Patterns that indicate a real measurable number tied to the product.
  // We deduplicate against the same exact substring so "4 pockets" mentioned
  // twice doesn't double-count.
  const patterns: RegExp[] = [
    // Number + unit (most common)
    /\b\d+(?:\.\d+)?\s*(?:inches?|in\.?|"|″|cm|mm|m|ft|feet|yards?|lb|lbs|pounds?|kg|g|oz|grams?|ml|l|liter|liters|gallon|gallons|gal|hours?|hrs?|h|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|watts?|w|kw|mAh|amps?|volts?|v|lumens?|nits|hz|psi|bar|btu|rpm|°|degrees?|fahrenheit|celsius|f\b|c\b|miles?|mph|km|kmh)\b/gi,
    // Count + noun (e.g. "7 compartments", "12 ports", "4 pockets", "3 settings")
    /\b\d+\s+(?:pockets?|compartments?|slots?|ports?|cameras?|channels?|settings?|modes?|speeds?|levels?|colors?|colours?|sizes?|pieces?|items?|accessories|attachments?|brushes?|heads?|tips?|blades?|cups?|cards?|sensors?|lights?|leds?|outlets?)\b/gi,
    // Percentages
    /\b\d+\s*%/g,
    // Resolution / pixel patterns (2K, 4K, 1080p, etc.)
    /\b(?:2k|4k|8k|1080p|720p|2160p|hd|fhd|uhd)\b/gi,
    // Capacity formats (e.g. "32 GB", "1 TB")
    /\b\d+\s*(?:gb|mb|tb|kb)\b/gi,
  ]
  const seen = new Set<string>()
  for (const re of patterns) {
    const matches = text.match(re) || []
    for (const m of matches) seen.add(m.toLowerCase().trim())
  }
  return seen.size
}

/** Cap on what we send to Haiku. Very long posts (15k+ chars) drive up
 *  cost + latency without proportional benefit — the tics tend to
 *  cluster in the body sections, not the boilerplate. */
const MAX_INPUT_CHARS = 25_000

export async function selfCheckBlogPost(opts: {
  content: string
  productTitle: string
  ctx: { userId: string | null; tier: string | null }
}): Promise<BlogSelfCheckResult> {
  const { content, productTitle, ctx } = opts

  // Truncate by character count rather than tokens. Haiku reads HTML fine;
  // we don't need clean cut-at-paragraph since the truncation is only an
  // input cap for the violation-finder, not part of any output.
  const truncated = content.length > MAX_INPUT_CHARS
    ? content.slice(0, MAX_INPUT_CHARS) + '\n\n[…article truncated for self-check, but check what you have above]'
    : content

  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are auditing a product review article for "${productTitle}" against a SPECIFIC list of style violations that may have slipped past the writing-time prompt.

VIOLATIONS TO HUNT (look for these patterns and close variants — do NOT flag anything not on this list):

1. INSIDER-KNOWLEDGE FRAMING — any phrasing claiming this post reveals what other reviews miss:
   "nobody talks about", "most reviews won't mention", "nobody explains", "what other reviewers won't mention", "the part nobody mentions", "the thing nobody covers".

2. SMALL-DETAIL TIC — any sentence that flags a detail's size before praising it:
   "small thing but matters", "small detail but", "small but mighty", "small, but matters", "this is a small thing, but…".

3. AI EMPHASIS DEFENSE — model insists it's sincere or not exaggerating. Hunt all variants:
   "I don't throw that word around lightly", "that's not exaggeration", "I'm not exaggerating", "I'm not kidding", "no, really", "I mean it", "I really mean it", "I mean it here", "I mean that", "I said it on camera and I mean it here", "I said it in the video and I'll say it here", "I meant that genuinely", "I meant it genuinely", "I meant that sincerely", "trust me", "trust me on this", "believe me", "for real" — ANY sentence whose function is to re-assert the writer's sincerity.

4. THE WORD "GENUINELY" IN ANY POSITION — banned everywhere, not just "like genuinely" compounds:
   "I genuinely think", "genuinely good", "like genuinely surprising", "I meant that genuinely", "genuinely impressed" — every occurrence. Cut the word and rephrase.

5. EM-DASH IN A HEADING — any <h2> or <h3> tag whose text contains the em-dash character (—). Em-dashes are allowed inside body paragraphs but BANNED in headings.

6. CONCLUSION CRESCENDO — emotional verdict flourish:
   "I think these things are fantastic", "really cool, really unique", "small, mighty, and powerful — that's the X in three words", "honestly fantastic" (and "honest" is also banned outright).

7. CORPORATE-PRAISE PATTERNS — soft form of crescendo, dressed as measured but still pat-on-the-back filler:
   "delivers what it promises", "delivers on its promise", "does what it promises", "lives up to its promise", "lives up to the hype", "lives up to the name", "earns its place", "earns its keep", "is the real deal", "is exactly what it claims to be", "is exactly what it says on the tin".
   These read as marketing copy. The verdict should state what the product concretely does + the trade-off.

8. "SOME USERS / SOME PEOPLE" HEDGE — any list item or sentence starting with "Some users", "Some people", "Some folks" — these are personas, not lived experience, and banned in the cons section.

9. GENERIC OPENING-SENTENCE SHAPES — if the article's FIRST body sentence matches any of these, flag it as a violation (the opening hook is the single highest-stakes line):
   "We tested [product]", "We tried out [product]", "We tried [product]", "Here's my review of [product]", "Here's our take on [product]", "Today we're looking at [product]", "In this review I'll cover [product]", "I'll be reviewing [product]", "This is a review of [product]", or any "[We|I] [tested|tried|reviewed|checked out|unboxed] this [product/category]" frame.
   The opener must be a specific lived moment, surprising observation, or concrete personal stake from the test. Suggest a rewrite that mines the transcript moment instead.

10. SOFT H2 LEAD-LINE OPENERS — the FIRST sentence under each <h2> heading (excluding the very first body sentence, which rule 9 covers) is what Google's featured-snippet picker and AI Overview lift verbatim. If a section's first sentence opens with any of these soft setups, flag it:
   "When it comes to [topic]…", "When you're looking at [topic]…", "There are [a few / several / a number of] [things / reasons / factors]…", "Let's [talk about / dive into / get into] [topic]…", "One thing to [know / note] about [topic]…", "It's [worth noting / important to note] that…", "If you're [in the market for / considering / wondering about] [topic]…", or any "[Product] is a [category] that…" / "[Product] is designed to…" sentence that just restates the product's category instead of delivering a verdict.
   Suggest a rewrite that DELIVERS the section's punchline in ≤ 22 words — a verdict, a number, a yes/no, or a concrete fact that answers what the H2 implies. Example fix: H2 "Battery life" → instead of "When it comes to battery life, the X1 offers solid performance for most users." → "Battery life: ~90 minutes in eco mode, half that on max. Enough for one floor, not two."

11. GENERIC VERDICT-BOX OPENERS + SIGN-OFFS — the gr-verdict-text (Quick Verdict) and gr-rating-text (Final Rating) are the two most-anchored lines in the post and the most prone to AI-uniform phrasing. Flag any sentence INSIDE a <div class="gr-verdict-box"> or <div class="gr-rating-box"> that opens with or closes on these tells:
   OPENERS to flag: "Overall, the [product]…", "All things considered…", "After [N] weeks of testing…", "In conclusion…", "Bottom line:", "The [product] is a solid…", "This is a great…", "If you're looking for [category], the [product] is…", "Going in I expected…".
   SIGN-OFFS to flag: "Highly recommended", "Would buy again", "Won me over", "Worth every penny", "A no-brainer at this price", "Earns its place in my [kitchen / shop / lineup / setup]", "Couldn't be happier", "Hands down the best".
   Suggest a rewrite that LANDS a specific concrete claim — name the decisive trade-off, the actual moment, or the precise audience who shouldn't buy it. Example fix: "Overall, the X1 is a solid grinder that delivers great value." → "Loses half a star for the cable management; the rest is the best $80 grinder I've used. Skip it for espresso — the burr can't go fine enough."

FOR EACH VIOLATION FOUND, propose a rewrite that:
  - Cuts the banned phrase entirely (do NOT swap it for a synonym of the same tic — "tiny but mighty" is the same violation as "small but mighty")
  - Preserves the surrounding sentence meaning + first-person voice
  - Doesn't change any HTML markup or attributes around the sentence
  - Keeps the same approximate length (no dropping in 3 new sentences)

OUTPUT FORMAT: a JSON array of objects, each shape exactly:
  { "pattern": "<short label, e.g. 'em-dash heading' or 'insider-knowledge framing'>",
    "original": "<the EXACT verbatim sentence or heading text from the article>",
    "suggested": "<the rewritten sentence with the tic removed>" }

CRITICAL:
- "original" MUST be a verbatim substring of the article — we apply your suggestions via exact string-replace, so a paraphrased original means the fix won't land.
- For heading violations, include the full <h2>...</h2> or <h3>...</h3> tag with attributes preserved (e.g. <h2 class="…">Real heading text</h2>) — only change the inner text.
- Return ONLY the JSON array. No prose before or after. No code fences.
- If you find NO violations, return an empty array: [].

THE ARTICLE:
${truncated}`,
      }],
    })

    recordAnthropicUsage(msg, {
      userId: ctx.userId,
      tier: ctx.tier,
      feature: 'blog_self_check',
      model: 'claude-haiku-4-5-20251001',
    })

    const raw = (msg.content[0] as { type: string; text: string }).text.trim()
    const jsonStart = raw.indexOf('[')
    const jsonEnd = raw.lastIndexOf(']')
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      // Couldn't find a JSON array — treat as no violations rather than
      // failing the whole pass. Most likely Haiku returned a "[] (no
      // violations found)" with prose around it that we couldn't parse.
      return { content, violations: [], fixesApplied: 0, numbersDetected: countProductSpecificNumbers(content) }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    } catch {
      return { content, violations: [], fixesApplied: 0, numbersDetected: countProductSpecificNumbers(content) }
    }
    if (!Array.isArray(parsed)) {
      return { content, violations: [], fixesApplied: 0, numbersDetected: countProductSpecificNumbers(content) }
    }

    // Apply each fix via plain string-replace (NOT regex, so violation
    // text containing special chars can't break the apply). The substring
    // must appear verbatim — if it doesn't, mark applied=false and move
    // on. We don't retry with fuzzy matching; partial matches risk
    // rewriting unrelated text or worse, mangling HTML attribute values.
    let updated = content
    const violations: BlogSelfCheckViolation[] = []
    let fixesApplied = 0
    for (const raw_v of parsed as Array<Record<string, unknown>>) {
      const pattern = typeof raw_v.pattern === 'string' ? raw_v.pattern : 'unknown'
      const original = typeof raw_v.original === 'string' ? raw_v.original : ''
      const suggested = typeof raw_v.suggested === 'string' ? raw_v.suggested : ''
      if (!original || !suggested || original === suggested) continue
      let applied = false
      if (updated.includes(original)) {
        updated = updated.replace(original, suggested)
        applied = true
        fixesApplied++
      }
      violations.push({ pattern, original, suggested, applied })
    }

    // Count product-specific numbers in the FINAL content (after fixes).
    // RULE 11 requires ≥3 per post; we only LOG when below threshold so a
    // genuinely spec-light transcript doesn't block publish — directional
    // signal for which posts need more measurement-mining.
    const numbersDetected = countProductSpecificNumbers(updated)
    return { content: updated, violations, fixesApplied, numbersDetected }
  } catch (err) {
    // Defensive: a Haiku timeout, rate-limit, or schema drift must NEVER
    // block the post from publishing. Ship the original content. We still
    // attempt the number count on the original so the telemetry survives.
    console.warn('[blog-self-check] failed — shipping original content:', err instanceof Error ? err.message : err)
    let numbersDetected = 0
    try { numbersDetected = countProductSpecificNumbers(content) } catch { /* swallow — best-effort */ }
    return { content, violations: [], fixesApplied: 0, numbersDetected }
  }
}
