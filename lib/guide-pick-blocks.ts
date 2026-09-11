// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The three things a buying-guide section was missing.
//
// A guide built from a creator's own reviews sent every click to the review
// post. No video, and no way to buy. So a reader sold by section 3 had to click
// through to the review, find the button there, and click again, and the ones
// who were ready to buy right then simply left. Meanwhile the video that the
// whole review was made from, the thing that actually sells a product, was not
// on the page at all.
//
// Each section now carries:
//   the source video, playable in place
//   a buy link for readers who are already sold
//   the review link for readers who want the detail
//
// WHY THIS IS BUILT IN CODE AND NOT BY THE MODEL
//
// The writer used to be handed the review URL and asked to emit the CTA itself.
// A model that writes a URL is a model that can mistype one, drop one, or give
// two sections the same one, and a wrong affiliate link is worse than none: it
// pays someone else, or it 404s, and nothing on the page looks wrong. So the
// writer now emits a marker per section and every link is assembled here, from
// data, and placed by string replacement.
//
// Markers, not trust: injectPickBlocks REPORTS what it placed and what it could
// not. A guide that quietly published with two of five buy buttons is exactly
// the failure this module exists to make visible.

export interface GuidePick {
  /** 1-based position in the guide, matching the marker the writer emits. */
  index: number
  /** Short product name, for the button label and the image alt. */
  name: string
  /** The creator's own review post for this product. */
  reviewUrl: string | null
  /** YouTube id of the review video, when the pick came from an MVP review
   *  with a source video. Null for a pick read back from WordPress alone. */
  youtubeVideoId: string | null
  /** Thumbnail, used when there is no video id to embed. */
  thumbnailUrl: string | null
  /** The cloaked buy link, already resolved to the creator's link style. */
  buyUrl: string | null
  /** True when the destination is an Amazon product.
   *
   *  This drives the words on the button, and it is not cosmetic. Amazon's
   *  Associates policy 6(w) forbids a placement that makes it unclear you are
   *  linking to an Amazon site, and nobody can tell that a geni.us or Passport
   *  link goes to Amazon by looking at it. The label is the only thing that
   *  makes it clear, so it is derived from the destination rather than assumed. */
  buyIsAmazon: boolean
}

export type Placement = 'marker' | 'heading' | 'missing'

export interface PickPlacement {
  index: number
  media: Placement
  cta: Placement
  hasVideo: boolean
  hasBuyLink: boolean
  hasReviewLink: boolean
}

export interface InjectionReport {
  picks: PickPlacement[]
  /** Sections that got a playable video. */
  withVideo: number
  /** Sections that got a buy button. */
  withBuyLink: number
  /** Sections where a block could not be placed at all. */
  unplaced: number
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const mediaMarker = (i: number) => `<!--MVP_MEDIA_${i}-->`
export const ctaMarker = (i: number) => `<!--MVP_CTA_${i}-->`

/**
 * The video, playable in place.
 *
 * This is the same block the comparison generator uses, and it works because of
 * WordPress's autoembed: a YouTube URL alone on its own line inside the embed
 * wrapper is turned into the player when the content is rendered. Writing a raw
 * <iframe> instead would be stripped for any author without unfiltered_html,
 * which is most of them, and the section would silently lose its video.
 *
 * With no video id there is still the thumbnail, linked to the review. That is
 * the old behaviour, kept as the floor rather than the target.
 */
export function pickMediaHtml(p: GuidePick): string {
  if (p.youtubeVideoId) {
    const url = `https://www.youtube.com/watch?v=${p.youtubeVideoId}`
    return `\n<!-- wp:embed {"url":"${url}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->\n<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">\n${url}\n</div></figure>\n<!-- /wp:embed -->\n`
  }
  if (p.thumbnailUrl) {
    const img = `<img src="${esc(p.thumbnailUrl)}" alt="${esc(p.name)}" style="width:100%;height:auto;border-radius:10px" loading="lazy" />`
    return p.reviewUrl
      ? `\n<figure style="margin:0 0 18px"><a href="${esc(p.reviewUrl)}">${img}</a></figure>\n`
      : `\n<figure style="margin:0 0 18px">${img}</figure>\n`
  }
  return ''
}

/**
 * The two ways out of a section: buy now, or read the whole review.
 *
 * Both, side by side, on purpose. Sending everyone to the review loses the
 * reader who is already decided; sending everyone to the product loses the one
 * who still has a question. The buy button leads because it is the one the old
 * layout had no answer for at all.
 */
export function pickCtaHtml(p: GuidePick): string {
  const parts: string[] = []
  if (p.buyUrl) {
    const label = p.buyIsAmazon ? `Check price on Amazon →` : `Check price →`
    parts.push(
      `<a href="${esc(p.buyUrl)}" target="_blank" rel="nofollow sponsored noopener" style="display:inline-flex;align-items:center;gap:8px;background:#f5a623;color:#1d1d1f;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">${label}</a>`,
    )
  }
  if (p.reviewUrl) {
    parts.push(
      `<a href="${esc(p.reviewUrl)}" style="display:inline-flex;align-items:center;gap:8px;background:#7C3AED;color:#fff;font-size:14px;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">Read the full review →</a>`,
    )
  }
  if (!parts.length) return ''
  return `\n<p style="display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 32px">${parts.join('')}</p>\n`
}

/**
 * Put each pick's blocks into the written guide.
 *
 * Markers first. When the writer dropped one, fall back to the section's
 * heading: media goes straight after the Nth </h2>, the CTA goes just before
 * the N+1th <h2> (or at the end for the last pick). Both paths are reported,
 * because a guide that fell back for every section means the marker instruction
 * stopped working and somebody should know before it happens fifty more times.
 */
export function injectPickBlocks(html: string, picks: GuidePick[]): { html: string; report: InjectionReport } {
  let out = html
  const placements: PickPlacement[] = []

  // Heading offsets are recomputed per pick because each insertion shifts them.
  const headingPositions = (s: string): Array<{ open: number; afterClose: number }> => {
    const res: Array<{ open: number; afterClose: number }> = []
    const re = /<h2\b[^>]*>[\s\S]*?<\/h2>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) res.push({ open: m.index, afterClose: m.index + m[0].length })
    return res
  }

  // The guide's own H2s (Quick recap, FAQ, the wrap-up) are headings too, so the
  // Nth H2 is not the Nth PICK. Pick sections are numbered by the writer, so
  // match the heading that starts with that number.
  const pickHeadingIndex = (s: string, n: number): { open: number; afterClose: number } | null => {
    const all = headingPositions(s)
    const numbered = all.filter(h => /<h2\b[^>]*>\s*(?:<[^>]+>\s*)*\d+\s*[.)]/i.test(s.slice(h.open, h.afterClose)))
    return numbered[n - 1] ?? null
  }

  for (const p of picks) {
    const media = pickMediaHtml(p)
    const cta = pickCtaHtml(p)
    let mediaPlaced: Placement = media ? 'missing' : 'missing'
    let ctaPlaced: Placement = cta ? 'missing' : 'missing'

    // ── media ──
    if (media) {
      const mk = mediaMarker(p.index)
      if (out.includes(mk)) {
        out = out.replace(mk, media)
        mediaPlaced = 'marker'
      } else {
        const h = pickHeadingIndex(out, p.index)
        if (h) {
          out = out.slice(0, h.afterClose) + media + out.slice(h.afterClose)
          mediaPlaced = 'heading'
        }
      }
    }

    // ── cta ──
    if (cta) {
      const mk = ctaMarker(p.index)
      if (out.includes(mk)) {
        out = out.replace(mk, cta)
        ctaPlaced = 'marker'
      } else {
        const next = pickHeadingIndex(out, p.index + 1)
        const here = pickHeadingIndex(out, p.index)
        if (next) {
          out = out.slice(0, next.open) + cta + out.slice(next.open)
          ctaPlaced = 'heading'
        } else if (here) {
          // Last pick: the next heading belongs to the FAQ or the wrap-up, so
          // land before whichever heading comes next, else at the very end.
          const after = headingPositions(out).find(x => x.open > here.afterClose)
          const at = after ? after.open : out.length
          out = out.slice(0, at) + cta + out.slice(at)
          ctaPlaced = 'heading'
        }
      }
    }

    placements.push({
      index: p.index,
      media: mediaPlaced,
      cta: ctaPlaced,
      hasVideo: !!p.youtubeVideoId,
      hasBuyLink: !!p.buyUrl,
      hasReviewLink: !!p.reviewUrl,
    })
  }

  // Any marker the writer emitted for a pick we had nothing to put in must not
  // reach the reader as an HTML comment.
  out = out.replace(/<!--MVP_(?:MEDIA|CTA)_\d+-->/g, '')

  return {
    html: out,
    report: {
      picks: placements,
      withVideo: placements.filter(p => p.hasVideo && p.media !== 'missing').length,
      withBuyLink: placements.filter(p => p.hasBuyLink && p.cta !== 'missing').length,
      unplaced: placements.filter(p => (p.hasVideo && p.media === 'missing') || (p.hasBuyLink && p.cta === 'missing')).length,
    },
  }
}

/**
 * One sentence describing what the published guide actually carries.
 *
 * Shown to the creator, not logged. "Published" told them nothing about whether
 * the thing they published can earn: a guide with five sections and one buy
 * button looks exactly like a guide with five.
 */
export function describePickCoverage(report: InjectionReport): string {
  const n = report.picks.length
  if (!n) return 'No picks in this guide.'
  const bits = [`${n} picks`]
  bits.push(report.withVideo === n ? 'all with a playable video' : `${report.withVideo} with a playable video`)
  bits.push(report.withBuyLink === n ? 'all with a buy link' : `${report.withBuyLink} with a buy link`)
  let s = bits.join(', ') + '.'
  const noBuy = report.picks.filter(p => !p.hasBuyLink).length
  if (noBuy) {
    s += ` ${noBuy === 1 ? 'One pick has' : `${noBuy} picks have`} no product link in the review it came from, so ${noBuy === 1 ? 'that section' : 'those sections'} only links to the review.`
  }
  if (report.unplaced) {
    s += ` ${report.unplaced} ${report.unplaced === 1 ? 'block' : 'blocks'} could not be placed in the written guide, so ${report.unplaced === 1 ? 'that section is' : 'those sections are'} missing what it should carry.`
  }
  return s
}
