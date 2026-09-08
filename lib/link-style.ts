// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Which cloaker a creator's links go through. One decision, no I/O.
//
// This sits in its own file so both sides can ask the same question. The full
// resolver (lib/link-cloak) imports lib/channel-share-url, and channel-share-url
// needs the rule too; importing the resolver back would be a cycle, and the copy
// that was inlined there to avoid one drifted from the original. A creator whose
// YouTube description and whose share link disagree about their link style has,
// from where they sit, a broken product.

export type LinkStyle = 'passport' | 'geniuslink' | 'bitly' | 'direct'

/**
 * The Geniuslink credentials to actually call with.
 *
 * Every generator that wraps a link reads the creator's row for itself and then
 * checks `style === 'geniuslink' && row.key && row.secret`. When those two reads
 * disagree — an agency route reading the VA's row while the style came from the
 * owner's, a select that didn't ask for both columns, a row written after the
 * style was — the style says Geniuslink, the keys read as missing, and the
 * feature quietly publishes a plain link. Nothing on screen says why.
 *
 * getLinkStyle already loaded the keys from the same row it made the decision
 * from, so they are the authority; a caller's own row is only a preference.
 * Returns null when neither has a usable pair, which is the one honest reason to
 * skip Geniuslink.
 */
export function geniuslinkCreds(
  cfg: { geniuslinkKey?: string | null; geniuslinkSecret?: string | null } | null | undefined,
  row?: { geniuslink_api_key?: string | null; geniuslink_api_secret?: string | null } | null,
): { key: string; secret: string } | null {
  const key = (row?.geniuslink_api_key || cfg?.geniuslinkKey || '').trim()
  const secret = (row?.geniuslink_api_secret || cfg?.geniuslinkSecret || '').trim()
  return key && secret ? { key, secret } : null
}

/**
 * The style a link ALREADY uses, read off the URL itself.
 *
 * pickLinkStyle answers "what should this creator get". This answers "what did
 * they actually get", and the pair is the only way to see a post that disagrees
 * with its own settings. Until this existed the repair tool could only find
 * links that were BROKEN, so a creator whose posts carried plain tagged Amazon
 * links while their profile said Geniuslink clicked Fix Affiliate Links, was
 * told "no broken affiliate links found", and reasonably read that as "you are
 * fine". Every link worked. None of them was the one he chose.
 *
 * Returns null for a URL with no style to read: a non-Amazon store page, a
 * relative href, anything that is not a buy link. Null means "not a candidate",
 * never "wrong", because a mismatch has to be certain before the tool offers to
 * rewrite somebody's published post.
 */
export function styleOfUrl(url: string | null | undefined): LinkStyle | null {
  const s = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return null
  if (/(?:geni\.us|\bgnz\.)/i.test(s)) return 'geniuslink'
  if (isPassportUrl(s)) return 'passport'
  if (/\bbit\.ly\//i.test(s)) return 'bitly'
  // amzn.to and a.co are Amazon's OWN shorteners, not a cloaker the creator
  // picked. They read as direct: the tag rides inside them.
  if (/amazon\.[a-z.]+/i.test(s) || /(?:amzn\.to|a\.co)\//i.test(s)) return 'direct'
  return null
}

/** The two shapes a Passport Link comes in: a code at the root of the branded
 *  short domain (www.mvpl.ink/x7k) and the app-origin fallback (/go/x7k) that
 *  older links were minted on.
 *
 *  The same rules as passportCodeFromUrl in lib/passport-links, deliberately
 *  restated rather than imported: this module is dependency-free on purpose
 *  (see the file header), and passport-links pulls in the admin Supabase client.
 *  A restatement that drifts is the exact failure this file was created to stop,
 *  so scripts/test-link-restyle pins the two against each other.
 *
 *  A Passport creator whose links these fail to recognise does not see a
 *  cosmetic bug: the repair tool reads its own freshly minted Passport link as
 *  the wrong style, refuses its own work, and reports that their posts cannot be
 *  converted. So the check has to be exact, and it has to honour
 *  PASSPORT_LINK_BASE the same way minting does. */
function isPassportUrl(s: string): boolean {
  let u: URL
  try { u = new URL(s) } catch { return false }
  const code = /^[A-Za-z0-9]{4,16}$/
  if (/^\/go\/[A-Za-z0-9]{4,16}\/?$/.test(u.pathname)) return true
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  let brandedHost = ''
  try {
    const base = (process.env.PASSPORT_LINK_BASE || '').trim() || 'https://www.mvpl.ink'
    brandedHost = new URL(base).hostname.toLowerCase().replace(/^www\./, '')
  } catch { /* unparseable override → the known domain below still applies */ }
  if (host !== 'mvpl.ink' && (!brandedHost || host !== brandedHost)) return false
  return code.test(u.pathname.replace(/^\/+/, '').replace(/\/+$/, ''))
}

/**
 * Passport (eligible) wins; else the stored mode; a mode whose credentials are
 * missing downgrades to 'direct' so a link is never left unmade.
 *
 * NO STORED MODE + GENIUSLINK KEYS = GENIUSLINK. A creator who typed their
 * Geniuslink API key and secret into MVP wants their links to go through
 * Geniuslink; nobody stores paid API credentials they do not want used. Before
 * this, an empty mode meant 'direct', so a creator with working keys published
 * plain Amazon links with nothing on screen to explain why. An empty mode is
 * genuinely common: the column arrived after the keys did, and a save that
 * omitted the field used to blank it. An EXPLICIT 'direct' still means direct.
 * This only reads the silence.
 */
export function pickLinkStyle(o: {
  passportEligible: boolean
  mode: string | null | undefined
  hasBitly: boolean
  hasGeniuslink: boolean
}): LinkStyle {
  // PASSPORT WINS WHEN IT IS ON, and the reason is worth writing down because
  // it was briefly changed the other way and had to be put back.
  //
  // blog_social_link_mode reads like a competing choice and is not one. It is
  // the style to use when Passport is OFF: the chooser deliberately offers only
  // direct / geniuslink / bitly (see the passportEligible: false in the settings
  // route), the UI renders `passportActive ? 'passport' : blogSocialLinkMode`,
  // and the settings screen writes the displayed value back on any save. So a
  // stored 'geniuslink' is frequently MVP's own computed default, not a
  // decision a creator made.
  //
  // Treating it as an explicit choice that outranks the toggle read as a fix
  // for a creator whose chooser said Geniuslink while Passport was in use. It
  // would have switched Passport off for every Passport account on the
  // platform: at the time, four of four had a stored mode and none was unset.
  //
  // What actually went wrong for that creator was two other things, both fixed:
  // Passport minting never worked from the blog job (no session, so RLS hid
  // their own row), and Co-Pilot told them to change a setting that could not
  // express Passport in the first place.
  if (o.passportEligible) return 'passport'
  const stored = (o.mode || '').trim().toLowerCase()
  if (!stored) return o.hasGeniuslink ? 'geniuslink' : 'direct'
  let style = stored
  if (style === 'bitly' && !o.hasBitly) style = 'direct'
  if (style === 'geniuslink' && !o.hasGeniuslink) style = 'direct'
  if (style !== 'bitly' && style !== 'geniuslink' && style !== 'direct') style = 'direct'
  return style as LinkStyle
}
