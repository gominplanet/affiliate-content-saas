// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Two scrubs that run on every piece of AI-generated HTML before it
// reaches WordPress.
//
// 1. stripCodeFence — Sonnet sometimes wraps its output in a markdown
//    code fence ("```html\n<actual content>\n```") even when the prompt
//    says "return ONLY the HTML". Without stripping, the fence renders
//    as literal text in the published post. Conservative: only strips
//    when the fence is the WHOLE document or starts at byte 0.
//
// 2. scrubEmDashes — the user's hard rule: NEVER em-dash. Anywhere.
//    Body, headings, attributes, alt text. The prompt repeats this
//    every generation but models still slip them in. The scrub replaces
//    every em-dash variant with a comma (or parens for parenthetical
//    asides). Same for en-dashes and the "double-hyphen" idiom some
//    models emit.
//
// Order: stripCodeFence FIRST (so we don't scrub the ``` itself),
// then scrubEmDashes on the unwrapped HTML.

/**
 * Remove a leading/trailing markdown code fence if Sonnet wrapped the
 * output in one. Safe to call on any string — returns unchanged when
 * no fence is present.
 */
export function stripCodeFence(raw: string): string {
  if (!raw) return raw
  let s = raw.trim()
  // Opening fence: ```html / ```HTML / ```  on its own line at the top
  s = s.replace(/^```(?:html|HTML)?\s*\n?/, '')
  // Closing fence: ``` at the end, possibly with trailing whitespace
  s = s.replace(/\n?\s*```\s*$/, '')
  return s.trim()
}

/**
 * Replace every em-dash + en-dash + double-hyphen "em-dash idiom" with
 * a sensible alternative. Default replacement is a comma; the regex
 * pattern handles a few subtleties:
 *
 *   "X — Y"           → "X, Y"           (most common case)
 *   "X—Y"             → "X, Y"           (no spaces)
 *   "X -- Y" / "X--Y" → "X, Y"           (ASCII idiom)
 *   "X – Y"           → "X, Y"           (en-dash variant)
 *   "&mdash;"/"&ndash;"/"&#8212;"/"&#8211;" → ", "
 *
 * We DON'T touch hyphens inside compound words ("self-care", "best-fit",
 * "well-being") — those are hyphen-minus (U+002D), not em-dashes. The
 * regex is anchored to whitespace or word boundaries around the dash
 * character so compound hyphens survive.
 *
 * Caveat: we never replace a dash inside an HTML attribute value or
 * inside a <code>/<pre> block. The 'inside-tags' guard splits the
 * input on tag boundaries, scrubs only the TEXT chunks, and
 * re-stitches.
 *
 * CRITICAL: HTML comments (Gutenberg block delimiters like
 * `<!-- wp:group {…} -->`) are pulled out and protected BEFORE anything
 * else — their `--`/`-->` sequences are exactly the double-hyphen idiom
 * this scrub rewrites to a comma. See the guard note inside.
 */
export function scrubEmDashes(html: string): string {
  if (!html) return html

  // ── GUARD HTML COMMENTS FIRST — critical for Gutenberg ──────────────────
  // Gutenberg block delimiters are HTML comments: `<!-- wp:group {…} -->`.
  // The `--`/`-->` in them IS the double-hyphen idiom the scrub rewrites to a
  // comma. The tag-split below is not safe on its own: a `>` inside an
  // attribute value or in review text (e.g. `alt="rated 4 > 3"`, "faster >
  // the rest") closes `<[^>]+>` early and desyncs every following chunk,
  // throwing later `<!-- … -->` delimiters into TEXT chunks that then get
  // scrubbed — turning `<!-- wp:group -->` into `<!, wp:group, >` and breaking
  // every block on the page. Pull comments out to an inert, DELIMITED token
  // (no dashes / angle-brackets / commas, so the scrub skips it; the trailing
  // `:]]` stops the index merging with a following digit like `<!-- … -->5`),
  // then restore verbatim.
  const comments: string[] = []
  const guarded = html.replace(/<!--[\s\S]*?-->/g, (m) => {
    comments.push(m)
    return `[[MVPCMT:${comments.length - 1}:]]`
  })

  // Split on tag boundaries — scrub only the text between tags.
  const parts = guarded.split(/(<[^>]+>)/g)
  let insideCodeOrPre = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.startsWith('<')) {
      // Track <code>/<pre> blocks so we don't scrub code samples.
      if (/^<(code|pre)\b/i.test(p)) insideCodeOrPre++
      else if (/^<\/(code|pre)\s*>/i.test(p)) insideCodeOrPre = Math.max(0, insideCodeOrPre - 1)
      continue // never touch tag text itself
    }
    if (insideCodeOrPre > 0) continue
    parts[i] = scrubText(p)
  }
  const scrubbed = parts.join('')

  // Restore the untouched comments verbatim.
  return scrubbed.replace(/\[\[MVPCMT:(\d+):\]\]/g, (_m, i) => comments[Number(i)] ?? '')
}

function scrubText(s: string): string {
  return s
    // HTML entities first — easiest case.
    .replace(/&mdash;/gi, ', ')
    .replace(/&ndash;/gi, ', ')
    .replace(/&#8212;/g, ', ')
    .replace(/&#8211;/g, ', ')
    .replace(/&#x2014;/gi, ', ')
    .replace(/&#x2013;/gi, ', ')
    // Em-dash + en-dash characters, with optional surrounding whitespace.
    // Collapse "X — Y" / "X—Y" / "X – Y" into "X, Y".
    .replace(/\s*[—–]\s*/g, ', ')
    // ASCII em-dash idiom — "X -- Y" or "X--Y". Anchor on whitespace or
    // word boundaries either side so we don't break "non--breaking" style
    // edge cases (unlikely but safe).
    .replace(/(\S)\s*--\s*(\S)/g, '$1, $2')
    // Collapse any double-comma the substitution may have produced.
    .replace(/,\s*,/g, ',')
}

/**
 * Combined helper — runs both scrubs in the correct order. Use this on
 * any HTML returned by Sonnet/Haiku before persisting or sending to WP.
 */
export function scrubAiHtml(raw: string): string {
  return scrubEmDashes(stripCodeFence(raw))
}
