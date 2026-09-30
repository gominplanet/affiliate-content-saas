// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// What every post says about how it was made, and what no post carries.
//
// HOW IT WAS MADE. Google's helpful-content guidance asks "How was this
// created?", its product-review guidance asks for evidence of first-hand use,
// and the FTC's reviews rule forbids implying experience nobody had. The
// writer already knows which it is (lib/experience-source), so each post says
// it in one plain line near the top: from the creator's own video, their own
// notes, a product they own, or research alone. The "How we test" page tells
// readers to look for this line.
//
// NO HASHTAG BLOCK. Ten hashtag pills at the foot of every post, on every
// site, carry no search value on a blog and are exactly the kind of identical
// scaffolding that marks pages as mass-produced.
import type { ExperienceSource } from '@/lib/experience-source'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function provenanceText(source: ExperienceSource | null | undefined, author?: string | null): string {
  const who = (author || '').trim() || 'I'
  const own = who === 'I' ? 'my own' : `${who}'s own`
  switch (source) {
    case 'video': return `How this review was made: written from ${own} video of the product, embedded below. Everything personal in it happened on camera.`
    case 'own-video': return `How this review was made: from ${own} video of the product, embedded below, with the details from the listing and the maker's specifications.`
    case 'creator-note': return `How this review was made: written from ${own} notes after using the product.`
    case 'owner': return `How this review was made: ${who === 'I' ? 'I own' : `${who} owns`} this product; the details come from the listing and the maker's specifications.`
    default: return 'How this review was made: researched from the product listing, its specifications and the questions buyers ask. We have not tested this product ourselves.'
  }
}

/** The line for a comparison or buying guide, which covers several products. */
export function comparisonProvenanceText(ownVideos: number, total: number, author?: string | null): string {
  const who = (author || '').trim()
  const own = who ? `${who}'s own` : 'my own'
  if (total > 0 && ownVideos === total) return `How this comparison was made: written from ${own} videos of each product.`
  if (ownVideos > 0) return `How this comparison was made: ${ownVideos} of the ${total} products come from ${own} videos; the rest from their listings, specifications and other creators' public videos, credited where used.`
  return 'How this comparison was made: researched from the product listings, their specifications and public videos, credited where used. We have not tested these products ourselves.'
}

export function withProvenanceNote(html: string, source: ExperienceSource | null | undefined, author?: string | null, text?: string): string {
  if (!html || html.includes('class="mvp-provenance"')) return html
  const block = `<!-- wp:paragraph {"className":"mvp-provenance","style":{"typography":{"fontSize":"13px"}}} -->\n<p class="mvp-provenance" style="font-size:13px;color:#6b6b70">${esc(text || provenanceText(source, author))}</p>\n<!-- /wp:paragraph -->\n`
  // Right after the disclosure block, so the two facts about the post sit
  // together near the top; else after the opening answer; else first.
  const disc = html.indexOf('#fffbe6')
  if (disc !== -1) {
    const end = html.indexOf('<!-- /wp:group -->', disc)
    if (end !== -1) { const at = end + '<!-- /wp:group -->'.length; return `${html.slice(0, at)}\n${block}${html.slice(at)}` }
  }
  const ans = html.indexOf('class="mvp-answer"')
  if (ans !== -1) {
    const end = html.indexOf('<!-- /wp:paragraph -->', ans)
    if (end !== -1) { const at = end + '<!-- /wp:paragraph -->'.length; return `${html.slice(0, at)}\n${block}${html.slice(at)}` }
  }
  return block + html
}

/** Remove the hashtag pill block wherever the writer still produced one. */
export function stripHashtagBlock(html: string): string {
  if (!html) return html
  return html.replace(/\s*<div class="gr-tags">[\s\S]*?<\/div>/gi, '')
}
