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
}

export interface FooterBlocks {
  /** "For more in depth reviews…", or null when there is no website. */
  blogLine: string | null
  /** "Let's Work Together!…", or null when there is no contact route at all. */
  collabLine: string | null
}

export function footerBlocks(input: FooterInput): FooterBlocks {
  const site = String(input.websiteUrl ?? '').trim()
  const email = String(input.contactEmail ?? '').trim()
  const pref = input.contactPreference

  const blogLine = site
    ? `For more in depth reviews, make sure to check out my blog: ${site}`
    : null

  // Which route the collaboration line should use. The creator's explicit pick
  // wins; otherwise whichever they actually filled in.
  let collabLine: string | null = null
  if (pref === 'email' && email) {
    collabLine = `Let's Work Together! Email me for collaborations: ${email}`
  } else if (pref === 'website' && site) {
    collabLine = `Let's Work Together! Check my WEBSITE for collaborations: ${site}`
  } else if (site) {
    collabLine = `Let's Work Together! Check my WEBSITE for collaborations: ${site}`
  } else if (email) {
    collabLine = `Let's Work Together! Email me for collaborations: ${email}`
  }

  // THE DUPLICATE. The collaboration line is about to print a URL the blog line
  // printed three lines earlier.
  if (blogLine && collabLine && sameUrl(site, extractUrl(collabLine))) {
    if (email && pref !== 'website') {
      // Two real routes exist and only one was being used. Use both.
      collabLine = `Let's Work Together! Email me for collaborations: ${email}`
    } else {
      // Only the website. Keep the invitation, drop the repeat.
      collabLine = `Let's Work Together! Brand collaborations welcome — reach me through the website linked above.`
    }
  }

  return { blogLine, collabLine }
}

/** The first http(s) URL in a line, or ''. */
function extractUrl(line: string): string {
  const m = line.match(/https?:\/\/\S+/)
  return m ? m[0] : ''
}
