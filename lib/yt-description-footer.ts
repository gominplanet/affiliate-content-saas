// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The two footer blocks that kept printing the same URL twice.
//
// A YouTube description ends with a blog backlink and a "Let's Work Together"
// collaboration line. Both were assembled independently, and both fall back to
// brand_profiles.website_url. So a creator whose collaboration contact IS their
// website got this, in two consecutive blocks:
//
//   For more in depth reviews, make sure to check out my blog: https://x.com/
//   ----------
//   Let's Work Together! Check my WEBSITE for collaborations: https://x.com/
//
// Neither block is wrong on its own, which is why it survived: you only see it
// in the assembled description, the same way the thumbnail contradictions were
// only visible in the assembled prompt.
//
// The rule this encodes: say each thing once. A creator with both a website and
// an email has two real contact routes, so the collaboration line uses the email
// and the URL is not repeated. A creator with only a website still gets the
// collaboration invitation, because brands look for it, but it points at the
// link already on screen instead of printing it again.

/** Same address? Compares the way a reader does, not the way a string does:
 *  scheme, www, trailing slash and case are all noise here. */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (raw: string | null | undefined): string => {
    const s = String(raw ?? '').trim().toLowerCase()
    if (!s) return ''
    return s
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
  }
  const na = norm(a)
  return !!na && na === norm(b)
}

export interface FooterInput {
  websiteUrl?: string | null
  contactEmail?: string | null
  /** The creator's explicit pick in Brand Profile → Brand Outreach Contact. */
  contactPreference?: 'website' | 'email' | null
  /** True when the description has an affiliate link, and therefore a slot high
   *  up (under the disclosure, above the hashtags) where the blog link earns
   *  its place. The blog link then goes THERE and nowhere else. */
  promoted?: boolean
  /** Anything the creator wrote themselves that will appear in the same
   *  description, e.g. their custom block. If their own text already carries
   *  the website, MVP does not add it again on top. */
  existingText?: string | null
  /** The finished wording for each line, already resolved against the
   *  creator's own overrides and with tokens filled (lib/yt-description-lines).
   *  This module decides WHICH lines appear; it no longer decides what they
   *  say, because that is the creator's to change. Omitted in tests and older
   *  callers, which then get MVP's defaults. */
  lines?: Partial<Record<'blogPromoted' | 'blogFull' | 'collabWebsite' | 'collabEmail' | 'collabNoLink', string>>
}

export interface FooterBlocks {
  /** The short arrow version that sits high in the description, above YouTube's
   *  "…more" fold. Null unless `promoted` was asked for. */
  promotedBlogLine: string | null
  /** The fuller line further down. Null when the promoted one is being used, so
   *  the address is printed once rather than in both places. */
  blogLine: string | null
  /** "Let's Work Together!…", or null when there is no contact route at all. */
  collabLine: string | null
}

export function footerBlocks(input: FooterInput): FooterBlocks {
  const site = String(input.websiteUrl ?? '').trim()
  const email = String(input.contactEmail ?? '').trim()
  const pref = input.contactPreference

  // The creator's own text wins. If they already link their site in their
  // custom block, MVP adding two more copies of it is not promotion, it is
  // clutter in someone else's description.
  const alreadyTheirs = !!site && urlAppearsIn(String(input.existingText ?? ''), site)

  // ONE blog link, in ONE place. The route used to push a short arrow version
  // high up AND this fuller version lower down, on the reasoning that the first
  // lands above the fold and the second is more complete. Read as a finished
  // description that is simply the same address twice, which is what a creator
  // reported: "the website is still wrong, is there a way I can edit the
  // description?". Above the fold is the better slot, so when it exists the
  // link goes there and the lower line stands down.
  const L = input.lines ?? {}
  const promotedBlogLine = site && input.promoted && !alreadyTheirs
    ? (L.blogPromoted || `👉 For more in-depth reviews, check out my blog: ${site}`)
    : null
  const blogLine = site && !promotedBlogLine && !alreadyTheirs
    ? (L.blogFull || `For more in depth reviews, make sure to check out my blog: ${site}`)
    : null

  // Which route the collaboration line should use. The creator's explicit pick
  // wins; otherwise whichever they actually filled in.
  let collabLine: string | null = null
  const collabEmailLine = L.collabEmail || `Let's Work Together! Email me for collaborations: ${email}`
  const collabSiteLine = L.collabWebsite || `Let's Work Together! Check my WEBSITE for collaborations: ${site}`
  if (pref === 'email' && email) {
    collabLine = collabEmailLine
  } else if (pref === 'website' && site) {
    collabLine = collabSiteLine
  } else if (site) {
    collabLine = collabSiteLine
  } else if (email) {
    collabLine = collabEmailLine
  }

  // THE DUPLICATE. The collaboration line is about to print a URL that already
  // appears above it: from one of the blog lines, whichever ran, or from the
  // creator's own custom block. Their own mention counts. The rule is that a
  // reader sees the address once, not that MVP printed it once.
  const siteAlreadyShown = !!blogLine || !!promotedBlogLine || alreadyTheirs
  if (siteAlreadyShown && collabLine && sameUrl(site, extractUrl(collabLine))) {
    if (email && pref !== 'website') {
      // Two real routes exist and only one was being used. Use both.
      collabLine = collabEmailLine
    } else {
      // Only the website. Keep the invitation, drop the repeat.
      collabLine = L.collabNoLink || `Let's Work Together! Brand collaborations welcome — reach me through the website linked above.`
    }
  }

  return { promotedBlogLine, blogLine, collabLine }
}

/** Does `text` already link `site`? Compares the way sameUrl does, so a
 *  creator writing "www.example.com/" counts as linking https://example.com. */
function urlAppearsIn(text: string, site: string): boolean {
  if (!text.trim()) return false
  return (text.match(/https?:\/\/\S+/g) || []).some((u) => sameUrl(u.replace(/[),.]+$/, ''), site))
}

/** The first http(s) URL in a line, or ''. */
function extractUrl(line: string): string {
  const m = line.match(/https?:\/\/\S+/)
  return m ? m[0] : ''
}
