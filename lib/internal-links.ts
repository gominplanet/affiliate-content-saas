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
}

export interface CurrentTopic {
  title: string
  keyword?: string | null
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
 * top `max` with a non-zero score (most relevant first). Candidates with no
 * shared meaningful token are dropped — we never inject an unrelated link.
 */
export function pickRelatedPosts(
  current: CurrentTopic,
  candidates: LinkCandidate[],
  max = 3,
): LinkCandidate[] {
  const currentTokens = tokenize(
    current.title,
    current.keyword,
    (current.tags || []).join(' '),
    (current.niches || []).join(' '),
    current.category,
  )
  if (currentTokens.size === 0) return []

  const scored = candidates
    .filter(c => c.title && c.url)
    .map(c => {
      const ct = tokenize(c.title, c.keyword)
      let score = 0
      for (const t of ct) if (currentTokens.has(t)) score++
      return { c, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

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
export function renderRelatedLinksBlock(related: LinkCandidate[], heading = 'Related reviews'): string {
  if (!related.length) return ''
  const items = related
    .map(r => `<li><a href="${esc(r.url)}">${esc(r.title)}</a></li>`)
    .join('')
  return `\n<!-- wp:heading -->
<h2 class="wp-block-heading">${esc(heading)}</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">${items}</ul>
<!-- /wp:list -->\n`
}

/**
 * Splice the related-links block into `content` just BEFORE the final heading
 * (usually the FAQ), so it sits in-body rather than trailing the whole post.
 * Falls back to appending at end when there are no headings.
 */
export function insertRelatedLinks(content: string, block: string): string {
  if (!block) return content
  const re = /<!-- wp:heading\b/g
  const offsets: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) offsets.push(m.index)
  if (offsets.length === 0) return content + block
  // Insert before the LAST heading (FAQ tail) → related reviews precede the FAQ.
  const at = offsets[offsets.length - 1]
  return content.slice(0, at) + block + content.slice(at)
}
