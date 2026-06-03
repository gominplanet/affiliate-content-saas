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

3. AI EMPHASIS DEFENSE — model insists it's not exaggerating:
   "I don't throw that word around lightly", "that's not exaggeration", "I'm not exaggerating", "I'm not kidding", "no, really".

4. "LIKE GENUINELY ___" COMPOUNDS — any sentence using "like genuinely" as an intensifier:
   "like genuinely good", "like genuinely surprising", "like genuinely nice", any "like genuinely + adjective".

5. EM-DASH IN A HEADING — any <h2> or <h3> tag whose text contains the em-dash character (—). Em-dashes are allowed inside body paragraphs but BANNED in headings.

6. CONCLUSION CRESCENDO — emotional verdict flourish:
   "I think these things are fantastic", "really cool, really unique", "small, mighty, and powerful — that's the X in three words", "honestly fantastic" (and "honest" is also banned outright).

7. "SOME USERS / SOME PEOPLE" HEDGE — any list item or sentence starting with "Some users", "Some people", "Some folks" — these are personas, not lived experience, and banned in the cons section.

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
      return { content, violations: [], fixesApplied: 0 }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    } catch {
      return { content, violations: [], fixesApplied: 0 }
    }
    if (!Array.isArray(parsed)) {
      return { content, violations: [], fixesApplied: 0 }
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

    return { content: updated, violations, fixesApplied }
  } catch (err) {
    // Defensive: a Haiku timeout, rate-limit, or schema drift must NEVER
    // block the post from publishing. Ship the original content.
    console.warn('[blog-self-check] failed — shipping original content:', err instanceof Error ? err.message : err)
    return { content, violations: [], fixesApplied: 0 }
  }
}
