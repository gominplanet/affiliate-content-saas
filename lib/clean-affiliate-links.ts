/**
 * Clean affiliate-link artifacts left behind in post HTML by other plugins
 * (notably Lasso) after they're removed.
 *
 * The one we fix today: a DUPLICATED Amazon affiliate tag. Lasso appended its
 * own `&tag=<creator-tag>` on top of a link that already carried the same tag,
 * producing e.g.
 *   amazon.com/s?k=Fabric+Storage+Bins&tag=lisamaslyk09-20&tag=lisamaslyk09-20
 * After Lasso is deleted, that duplicate is baked into the saved post content.
 * It's harmless (Amazon honours one), but sloppy — and it's a pure, reversible
 * text transform, so we can fix it with zero AI cost (no rebuild, no images).
 *
 * Deliberately conservative: we ONLY collapse an IMMEDIATELY-repeated, IDENTICAL
 * `tag=` param. We never change the destination, never touch a single-tag link,
 * never invent a product. Anything fancier (search link → product link) needs
 * real product resolution and is out of scope here.
 */

/** Ampersand between query params can be raw `&` or HTML-encoded
 *  (`&amp;` / `&#038;` / `&#38;`) depending on how WordPress stored it. */
const AMP = '(?:&amp;|&#0?38;|&)'

/**
 * Collapse repeated identical `tag=VALUE` query params down to one.
 * Returns the cleaned HTML and how many duplicate tags were removed.
 *
 * Handles triples+ (loops until stable) and all ampersand encodings. The
 * trailing boundary check (`(?![\w.~-])`) ensures we matched the WHOLE value,
 * so `tag=abc&tag=abcd` is left alone (different values).
 */
export function dedupeAffiliateTags(html: string): { html: string; fixed: number } {
  if (!html) return { html: html ?? '', fixed: 0 }
  const re = new RegExp(`(tag=([A-Za-z0-9_.~-]+))${AMP}tag=\\2(?![A-Za-z0-9_.~-])`, 'g')
  let out = html
  let fixed = 0
  let prev: string
  do {
    prev = out
    out = out.replace(re, (_m, keep: string) => { fixed++; return keep })
  } while (out !== prev)
  return { html: out, fixed }
}

/**
 * Run every cleaner over a post body. Single entry point so the route stays
 * simple and future artifact-fixers (e.g. stripping orphaned data-lasso-id
 * attributes) can be added here without touching callers.
 */
export function cleanPostLinks(html: string): { html: string; fixed: number } {
  const tags = dedupeAffiliateTags(html)
  return { html: tags.html, fixed: tags.fixed }
}
