/**
 * Topical internal linking for generated blog posts (SEO P1 — #15).
 *
 * Replaces "random related posts" with links chosen by TOPICAL RELEVANCE: we
 * score the user's existing published posts against the new post's topic
 * signals (title, SEO keyword, tags, niches, category) by token overlap and
 * surface the best 2–3 as a "Related reviews" block with descriptive anchor
 * text (the post title) — exactly the internal-linking pattern Google rewards
 * for topical authority.
 *
 * Deterministic + free (no AI call). Best-effort: returns [] / '' when there
 * are no relevant candidates, so it can never block generation.
 */

export interface LinkCandidate {
  title: string
  url: string
  keyword?: string | null
  /** First few hundred chars of the candidate's body text (HTML stripped). Used
   *  as extra topical signal so two posts whose TITLES don't overlap but whose
   *  body content does still match (e.g. one titled "YITAHOME Garden Bench"
   *  and another "Best Patio Furniture for Wet Weather"). */
  contentSnippet?: string | null
  /** 'review' | 'comparison' | 'guide'. Same type adds a small score bump. */
  postType?: string | null
}

export interface CurrentTopic {
  title: string
  keyword?: string | null
  contentSnippet?: string | null
  postType?: string | null
  tags?: string[]
  niches?: string[]
  category?: string | null
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at',
  'is', 'it', 'this', 'that', 'with', 'my', 'i', 'we', 'you', 'your', 'our',
  'best', 'review', 'reviews', 'vs', 'how', 'why', 'what', 'are', 'be', 'do',
  'does', 'did', 'will', 'can', 'should', 'worth', 'buy', 'get', 'new', 'top',
  'guide', 'tested', 'test', 'after', 'before', 'good', 'bad', 'really',
])

function tokenize(...parts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const p of parts) {
    if (!p) continue
    for (const raw of String(p).toLowerCase().split(/[^a-z0-9]+/)) {
      // Keep meaningful tokens: 3+ chars, not a stopword. Numbers kept (model #s).
      if (raw.length >= 3 && !STOPWORDS.has(raw)) out.add(raw)
    }
  }
  return out
}

/**
 * Rank `candidates` by topical overlap with the current post and return the
 * top `max` most relevant (most relevant first). A candidate qualifies only
 * when it shares at least `minOverlap` MEANINGFUL tokens with the current post
 * (default 1). The same-post_type bump is a tiebreak for ordering ONLY — it can
 * never make an off-topic post qualify on its own, so e.g. a juicer review does
 * not attach to a suitcase article just because both are reviews.
 */
export function pickRelatedPosts(
  current: CurrentTopic,
  candidates: LinkCandidate[],
  max = 3,
  minOverlap = 1,
): LinkCandidate[] {
  // Tokenize the CURRENT post from every signal available. We deliberately
  // include the content snippet — many older posts have a null seo_keyword and
  // a short title, so without the body the token set is too narrow and obvious
  // related posts get filtered out by "0 overlapping tokens".
  const currentTokens = tokenize(
    current.title,
    current.keyword,
    current.contentSnippet,
    (current.tags || []).join(' '),
    (current.niches || []).join(' '),
    current.category,
  )
  if (currentTokens.size === 0) return []

  const scored = candidates
    .filter(c => c.title && c.url)
    .map(c => {
      // Real topical relevance = count of shared meaningful tokens across
      // title + keyword + body snippet. This is what QUALIFIES a candidate.
      const ct = tokenize(c.title, c.keyword, c.contentSnippet)
      let overlap = 0
      for (const t of ct) if (currentTokens.has(t)) overlap++
      // Same post_type is a tiebreak for ORDERING only (reviews bond with
      // reviews). It must never qualify a post that shares no real topic, or an
      // unrelated post sneaks in whenever two posts happen to share a type.
      const sortScore = overlap + (current.postType && c.postType && current.postType === c.postType ? 0.5 : 0)
      return { c, overlap, sortScore }
    })
    .filter(s => s.overlap >= minOverlap)
    .sort((a, b) => b.sortScore - a.sortScore)

  // De-dupe by URL while preserving best-first order.
  const seen = new Set<string>()
  const out: LinkCandidate[] = []
  for (const s of scored) {
    if (seen.has(s.c.url)) continue
    seen.add(s.c.url)
    out.push(s.c)
    if (out.length >= max) break
  }
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Render a Gutenberg "Related reviews" block (heading + unordered list of
 * internal links). Anchor text is the post title (descriptive, keyword-rich).
 * Returns '' when there are no links.
 */
export function renderRelatedLinksBlock(related: LinkCandidate[], heading = 'Also worth considering'): string {
  if (!related.length) return ''

  // 2026-06-08 (#8 Also Consider): upgraded from a flat <ul> of links to a
  // card-style block — each candidate becomes a clickable card with the
  // post-type chip (Review / Comparison / Guide) so the reader can tell at a
  // glance whether they're heading into a single-product write-up or a
  // multi-product round-up. Visual upgrade matches Wirecutter / Tom's Guide
  // "Also great" pattern. CSS lives in the plugin (.gr-also-consider).
  const cards = related.map(r => {
    const typeLabel =
      r.postType === 'comparison' ? 'Comparison' :
      r.postType === 'guide'      ? 'Guide'      :
                                    'Review'
    return `<a class="gr-ac-card" href="${esc(r.url)}">
  <span class="gr-ac-chip">${esc(typeLabel)}</span>
  <span class="gr-ac-title">${esc(r.title)}</span>
  <span class="gr-ac-arrow" aria-hidden="true">→</span>
</a>`
  }).join('\n')

  return `\n<!-- wp:html -->
<aside class="gr-also-consider" aria-label="${esc(heading)}">
  <h2 class="gr-ac-heading">${esc(heading)}</h2>
  <div class="gr-ac-grid">
${cards}
  </div>
</aside>
<!-- /wp:html -->\n`
}

/**
 * Splice the related-links block into `content` just BEFORE the final heading
 * (usually the FAQ), so it sits in-body rather than trailing the whole post.
 * Falls back to appending at end when there are no headings.
 */
export function insertRelatedLinks(content: string, block: string): string {
  if (!block) return content
  // BEFORE THE FAQ'S OWN HEADING. This used to go before the LAST heading of
  // any level, which in a post with an FAQ is the last question's <h3>: the
  // block split the FAQ, and its <h2> cut the last question out of the FAQ
  // schema. So the FAQ heading is found first, and otherwise the last H2.
  const faq = content.search(/<!-- wp:heading[^>]*-->\s*<h2[^>]*>\s*(?:Frequently Asked Questions|FAQs?)\s*<\/h2>/i)
  if (faq !== -1) return content.slice(0, faq) + block + content.slice(faq)
  const re = /<!-- wp:heading(?![^>]*"level"\s*:\s*[3-6])[^>]*-->/g
  const offsets: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) offsets.push(m.index)
  if (offsets.length === 0) return content + block
  const at = offsets[offsets.length - 1]
  return content.slice(0, at) + block + content.slice(at)
}

// ── Linking TO a post from another one (SEO page, 2026-10-11) ────────────────

/** An address reduced to host + path, so http/https, www, a query string and a
 *  trailing slash are not the reason two links to the same post look apart. */
export function bareUrl(u: string | null | undefined): string {
  const s = String(u || '').trim().toLowerCase()
  if (!s) return ''
  return s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

/** Every address a post's HTML links to, as bare URLs. */
export function linkedAddresses(html: string | null | undefined): Set<string> {
  const out = new Set<string>()
  const re = /href\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  const s = String(html || '')
  while ((m = re.exec(s)) !== null) {
    const b = bareUrl(m[1])
    if (b) out.add(b)
  }
  return out
}

/** Add one link card pointing at `target` to a post's body: into its existing
 *  "Also worth considering" block when it has one, otherwise as a new block in
 *  the same place the auto-fixer puts it. Never adds a second link to a post
 *  the body already links to. Pure. */
export function addLinkToPost(content: string, target: LinkCandidate): { content: string; added: boolean; reason?: string } {
  if (!target.url || !target.title) return { content, added: false, reason: 'That post has no address.' }
  if (linkedAddresses(content).has(bareUrl(target.url))) {
    return { content, added: false, reason: 'This post already links there.' }
  }
  const typeLabel = target.postType === 'comparison' ? 'Comparison' : target.postType === 'guide' ? 'Guide' : 'Review'
  const card = `<a class="gr-ac-card" href="${esc(target.url)}">
  <span class="gr-ac-chip">${esc(typeLabel)}</span>
  <span class="gr-ac-title">${esc(target.title)}</span>
  <span class="gr-ac-arrow" aria-hidden="true">→</span>
</a>`
  const grid = content.match(/<div class="gr-ac-grid">/)
  if (grid && grid.index !== undefined) {
    const at = grid.index + grid[0].length
    return { content: `${content.slice(0, at)}\n${card}${content.slice(at)}`, added: true }
  }
  return { content: insertRelatedLinks(content, renderRelatedLinksBlock([target])), added: true }
}
