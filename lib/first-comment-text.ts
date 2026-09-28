// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The words of a pinned first comment, where no person wrote them: Liftoff's
// videos, older videos, and a Co-Pilot push whose generated comment came back
// empty. Pure, so the rules can be tested.
//
// THE LINK IS THE DESCRIPTION'S OWN. Whatever product link the creator chose
// for the description (their short link, Passport link, or Amazon link) is the
// one the comment carries, so clicks count in the same place.
//
// DISCLOSED NEXT TO THE LINK. Amazon asks for "(paid link)" or similar near an
// affiliate link, and the FTC for a disclosure that is hard to miss. A pinned
// comment with a bare affiliate link has neither.

const SOCIAL = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|fb\.com|twitter\.com|x\.com|pinterest\.com|threads\.net|linkedin\.com|patreon\.com|discord\.gg)/i

/** The product link a description carries: the first link that is not a
 *  social profile or a YouTube link. Null when there is none. */
export function productLinkIn(description: string | null | undefined): string | null {
  const urls = String(description || '').match(/https?:\/\/[^\s<>()"']+/gi) ?? []
  for (const raw of urls) {
    const u = raw.replace(/[.,;:!?)\]]+$/, '')
    if (SOCIAL.test(u)) continue
    return u
  }
  return null
}

const DISCLOSED = /\(paid link\)|#ad\b|\bad:|affiliate link|commission|as an amazon associate|sponsored/i

/** The comment with "(paid link)" beside its link when nothing in it says so. */
export function withLinkDisclosure(text: string, link: string | null): string {
  const t = String(text || '').trim()
  if (!link || !t.includes(link) || DISCLOSED.test(t)) return t
  return t.replace(link, `${link} (paid link)`)
}

/** A plain comment when no model is available: the link, disclosed, and a
 *  question that invites a reply. */
export function fallbackFirstComment(title: string | null | undefined, link: string | null): string {
  // The title is taken for a future variant; the plain comment does not use it.
  void title
  const ask = 'What would you want to know before buying one? Ask below and I will answer.'
  if (link) return `Here is the one from this video: ${link} (paid link)\n\n${ask}`
  return `Thanks for watching! ${ask}`
}

/** Tidy what a model returned: one comment, no quotes around it, capped. */
export function cleanFirstComment(raw: string | null | undefined): string {
  let t = String(raw || '').trim()
  t = t.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return t.slice(0, 1400)
}
