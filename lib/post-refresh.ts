// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Keeping review posts current, the honest way.
//
// WHY THE CREATOR WRITES THE UPDATE. Freshness is a ranking signal, and the
// cheap way to fake it is to reword a post and bump its date. Google names
// that as a spam pattern, and it is the fastest route to a site being treated
// as mass-produced. An automatic rewrite has nothing new to say either: MVP
// does not keep the video transcript, so re-running the fact-check months
// later would strip the creator's own on-camera claims as "unsupported".
//
// What a reader and a search engine both value, and only the creator has, is
// what happened after the review: still using it, it broke, the battery faded,
// they switched. So after REFRESH_AFTER_DAYS the Content page asks for one
// line, and that line goes into the post, in their words, labelled with how
// long after the review it was written. Only then is WordPress touched, so the
// post's modified date moves only when something real changed. The safe fixes
// (rel="sponsored" on every affiliate link, no hashtag block, current related
// posts) ride along on the same save.

import { ensureSponsoredRel } from '@/lib/sponsored-rel'
import { stripHashtagBlock } from '@/lib/post-provenance'

export const REFRESH_AFTER_DAYS = 90
export const REFRESH_NOTE_MAX = 700

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "3 months in", "1 year in". Elapsed time, never a calendar year, so the
 *  label reads correctly for as long as the post is up. */
export function sinceLabel(publishedAt: string | Date, now: Date = new Date()): string {
  const days = Math.max(0, (now.getTime() - new Date(publishedAt).getTime()) / 86_400_000)
  const months = Math.max(1, Math.round(days / 30.44))
  if (months < 24) return months === 12 ? '1 year in' : `${months} month${months === 1 ? '' : 's'} in`
  return `${Math.floor(months / 12)} years in`
}

/** The creator's line as it goes into the post: plain text, one paragraph. */
export function cleanRefreshNote(raw: string): string {
  return String(raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REFRESH_NOTE_MAX)
}

export function updateBlock(note: string, label: string): string {
  return `<!-- wp:paragraph {"className":"mvp-update"} -->\n<p class="mvp-update"><strong>Update, ${esc(label)}:</strong> ${esc(note)}</p>\n<!-- /wp:paragraph -->\n`
}

/**
 * Put the update near the top, where a returning reader looks for it: after
 * the provenance line, else after the disclosure, else after the opening
 * answer, else first. A new update goes above any earlier one, so they read
 * newest first and the history stays.
 */
export function insertUpdate(html: string, block: string): string {
  const after = (marker: string, closer: string): number => {
    const i = html.indexOf(marker)
    if (i === -1) return -1
    const end = html.indexOf(closer, i)
    return end === -1 ? -1 : end + closer.length
  }
  const at = [
    after('class="mvp-provenance"', '<!-- /wp:paragraph -->'),
    after('#fffbe6', '<!-- /wp:group -->'),
    after('class="mvp-answer"', '<!-- /wp:paragraph -->'),
  ].find((n) => n > 0)
  return at ? `${html.slice(0, at)}\n${block}${html.slice(at)}` : block + html
}

/** Everything a refresh does to the body, in one pure step. */
export function refreshedBody(html: string, note: string, label: string): string {
  let out = insertUpdate(html, updateBlock(note, label))
  out = stripHashtagBlock(out)
  out = ensureSponsoredRel(out)
  return out
}

/** Swap the related-posts block for a fresh one, or add one if the post has
 *  none. Unchanged when there is nothing to link to. */
export function withFreshRelated(html: string, block: string, insert: (h: string, b: string) => string): string {
  if (!block) return html
  const re = /\n?<!-- wp:html -->\s*<aside class="gr-also-consider"[\s\S]*?<\/aside>\s*<!-- \/wp:html -->\n?/
  return re.test(html) ? html.replace(re, block) : insert(html, block)
}
