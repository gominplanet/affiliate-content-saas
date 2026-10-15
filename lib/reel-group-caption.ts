// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The caption of a Page Reel that points to a Group post (Clip Factory, Group
// first): the clip's write-up without its outside links, since the first line
// MVP adds ("Get it here 👉 <Group post>") is where viewers go.

/** The clip's caption with its outside links taken out: the Page Reel points
 *  to the Group post instead. Pure. */
export function pageReelCaption(writeUp: string, hashtags: string[]): string {
  const body = (writeUp || '')
    .split('\n')
    .filter((l) => !/https?:\/\/|www\.|amzn\.to|geni\.us|mvpl\.ink/i.test(l))
    .filter((l) => !/link in (my )?bio/i.test(l))
    .filter((l) => !/(^|\s)#[\p{L}\p{N}_]+/u.test(l.trim()) || l.trim().split(/\s+/).some((w) => !w.startsWith('#')))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const tags = Array.from(new Set(hashtags.map((h) => h.replace(/^#/, '')).filter(Boolean))).slice(0, 8).map((h) => `#${h}`).join(' ')
  return [body, tags].filter(Boolean).join('\n\n')
}

const TAG_ONLY = /^(?:\s*#[\p{L}\p{N}_]+)+\s*$/u
const AD_TAG = /(?<![\w#])#(?:ad|sponsored)\b/gi

/** THE ORDER OF A FACEBOOK REEL'S CAPTION (Seb, 2026-10-15: "the link
 *  should be top, then the disclaimer, then the hashtags #ad #sponsored then
 *  the description, the the rest of the hashtags"):
 *    Get it here 👉 <link>
 *    <disclaimer>
 *
 *    #ad #sponsored
 *
 *    <description>
 *
 *    #the #other #hashtags
 *  The link line is the first line that has a link (it moves to the top if it
 *  was not), the disclaimer is added under it when the caption has none, and
 *  hashtag-only lines go to the end. Idempotent. Pure. */
export function facebookReelOrder(description: string, disclaimer: string): string {
  const lines = String(description || '').replace(/\r/g, '').split('\n')
  const linkAt = lines.findIndex((l) => /https?:\/\//i.test(l))
  const linkLine = linkAt >= 0 ? lines[linkAt].replace(AD_TAG, '').replace(/\s{2,}/g, ' ').trim() : ''
  const rest = lines.filter((_, i) => i !== linkAt).map((l) => l.replace(AD_TAG, '').replace(/[ \t]{2,}/g, ' ').trimEnd())
  const DISC = /\baffiliate\b|\bamazon associate|\bcommission\b|\bqualifying purchases\b/i
  const discLines = rest.filter((l) => DISC.test(l) && !TAG_ONLY.test(l))
  const tagLines = rest.filter((l) => TAG_ONLY.test(l))
  const body = rest.filter((l) => !DISC.test(l) && !TAG_ONLY.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const disc = (discLines.length ? discLines.map((l) => l.trim()).join(' ') : String(disclaimer || '').trim())
  const tags = Array.from(new Set(tagLines.join(' ').split(/\s+/).filter((t) => /^#[\p{L}\p{N}_]+$/u.test(t)))).join(' ')
  const head = [linkLine, disc].filter(Boolean).join('\n')
  return [head, '#ad #sponsored', body, tags].filter(Boolean).join('\n\n').trim()
}
