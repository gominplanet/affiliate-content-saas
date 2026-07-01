// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One-time repair for Gutenberg block comments corrupted by the old em-dash
// scrub (fixed in lib/html-scrub.ts, commit 9da75d73). That bug rewrote the
// `<!--`/`-->` delimiters:  `<!-- wp:group {…} -->`  →  `<!, wp:group {…}, >`
// which made every block render as raw text. WordPress then texturized the
// exposed JSON on display (straight quotes → curly), but the STORED content
// keeps the `<!,` / `, >` delimiters.
//
// This inverts the corruption surgically — it only touches spans that look
// like corrupted block comments, so it's safe to run on a partially-corrupted
// (or already-clean) post: a genuine `<!-- wp:x -->` is left untouched.

/** Count corrupted block-comment delimiters in a post's HTML. */
export function countCorruptedMarkers(html: string): number {
  if (!html) return 0
  // Each corrupted comment contributes one `<!,` opener.
  const m = html.match(/<!,/g)
  return m ? m.length : 0
}

/**
 * Repair corrupted Gutenberg block comments in place. Returns the fixed HTML
 * (unchanged if there was nothing to fix).
 */
export function repairCorruptedBlocks(html: string): string {
  if (!html) return html

  // 1. Restore the OPENING delimiter: `<!,` → `<!--`. `<!,` (a `<` followed by
  //    `!,`) does not occur in normal HTML/prose, so this is safe globally.
  let out = html.replace(/<!,/g, '<!--')

  // 2. Restore the CLOSING delimiter and normalize the JSON. After step 1 a
  //    corrupted comment reads `<!-- wp:… {curly-quoted json} , >`. Match from
  //    `<!--` to the first `, >`, but NEVER cross a genuine `-->` — so a real
  //    `<!-- wp:x -->` (which has no `, >` inside) is left alone. Inside the
  //    matched span, turn the display-texturized curly quotes back into the
  //    straight quotes Gutenberg's JSON requires.
  out = out.replace(/<!--((?:(?!-->)[\s\S])*?),\s*>/g, (_full, inner: string) => {
    const fixed = inner
      .replace(/[“”]/g, '"')   // curly double quotes → "
      .replace(/[‘’]/g, "'")   // curly single quotes → '
    return `<!--${fixed} -->`
  })

  return out
}
