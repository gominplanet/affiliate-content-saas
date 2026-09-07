// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Making the Passport dashboard say what it means.
//
// Four things on that page were presenting raw internals as if they were
// findings, on a screen a creator uses to decide where their money comes from:
//
//   WHERE CLICKS CAME FROM listed  Vhj3WN1cu6U 91  ·  C0QWUJCzoI8 89
//   TOP PRODUCTS mixed real products with blog posts, under raw Amazon page
//     titles still carrying their "Amazon.com:" prefix
//   COUNTRIES REACHED showed flags for some codes and a grey globe for others
//   DEVICES & BROWSERS reported 329 of 453 clicks as "Unknown", sitting in the
//     same list as Chrome and Safari as though it were a browser someone used
//
// None of these is a rendering accident. Each is the raw stored value shown
// unchanged, which is fine in a log and wrong in a report. The judgement about
// what a value MEANS belongs in one tested place rather than in JSX.

/** A YouTube video id: 11 chars of the URL-safe alphabet. Used to tell a video
 *  source apart from 'blog', 'direct' or a referrer hostname, all of which live
 *  in the same column. */
export function isYouTubeVideoId(s: string | null | undefined): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(String(s ?? ''))
}

/**
 * What to call a click source on screen.
 *
 * `titles` maps a video id to its title when we have it. A video we no longer
 * have a row for keeps its id, prefixed, so it reads as an identifier rather
 * than as a name and is still traceable.
 */
export function sourceLabel(source: string | null | undefined, titles?: Map<string, string>): string {
  const s = String(source ?? '').trim()
  if (!s || s === 'direct') return 'Direct'
  if (s === 'blog') return 'Blog'
  if (s === 'social') return 'Social'
  if (isYouTubeVideoId(s)) {
    const t = titles?.get(s)
    return t ? t : `YouTube video ${s}`
  }
  // Anything else is a referrer hostname. Drop the www so it reads as a site.
  return s.replace(/^www\./i, '')
}

/**
 * Clean a stored product label for display.
 *
 * Labels are whatever the generator had at mint time, which for an Amazon
 * product is often the page title complete with its marketplace prefix and a
 * paragraph of keywords. "Amazon.com: La Roche-Posay Effaclar A.Z. Acne Face
 * Gel with Azelaic Acid, 1.35oz | Salic..." is a real one.
 */
export function cleanProductLabel(label: string | null | undefined, asin?: string | null): string {
  let s = String(label ?? '').trim()
  // "Amazon.com:", "Amazon.co.uk :", "Amazon:" and friends.
  s = s.replace(/^amazon(\.[a-z.]+)?\s*:\s*/i, '')
  // A trailing keyword tail after a pipe or a bracketed spec dump adds nothing
  // to a chart row, but only trim it when there is a real name in front.
  const beforePipe = s.split('|')[0].trim()
  if (beforePipe.length >= 20) s = beforePipe
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return asin ? `Product ${asin}` : 'Untitled link'
  return s
}

/** A country's name from its ISO alpha-2 code, for every code and not only the
 *  ones someone remembered to add to a lookup table. */
export function countryName(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return c || 'Unknown'
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    return dn.of(c) || c
  } catch {
    return c
  }
}

/** The flag emoji for any alpha-2 code, built from the code itself rather than
 *  looked up, so a country nobody anticipated still gets a flag instead of a
 *  grey globe. */
export function countryFlag(code: string | null | undefined): string {
  const c = String(code ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return '🌐'
  return String.fromCodePoint(...[...c].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

export interface ClassifiedTotals {
  /** Clicks where we identified a real browser. */
  known: number
  /** Clicks whose agent we could not read. NOT desktop, NOT a browser. */
  unclassified: number
}

/**
 * How much of the traffic the device and browser breakdown actually accounts
 * for.
 *
 * The panel used to list "Unknown" beside Chrome and Safari as if it were a
 * browser people chose. It is not a browser; it is the share of the data that
 * is missing, and a reader deserves to be told that in those words before they
 * read anything else in the panel.
 */
export function coverage(rows: { browser?: string | null }[]): ClassifiedTotals {
  let known = 0
  let unclassified = 0
  for (const r of rows) {
    if (r.browser && r.browser !== 'Bot') known++
    else if (!r.browser) unclassified++
  }
  return { known, unclassified }
}

/** The sentence under the device and browser panel. Returns null when there is
 *  nothing to caveat, so a clean account is not nagged. */
export function coverageNote(c: ClassifiedTotals): string | null {
  const total = c.known + c.unclassified
  if (total === 0 || c.unclassified === 0) return null
  const pct = Math.round((c.known / total) * 100)
  return `Device and browser are known for ${c.known} of ${total} clicks (${pct}%). The rest arrived with an agent MVP could not read and are not counted in this panel.`
}
