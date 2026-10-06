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
