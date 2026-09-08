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
  const stored = (o.mode || '').trim().toLowerCase()

  // THE CREATOR'S OWN CHOICE COMES FIRST.
  //
  // This used to read `if (o.passportEligible) return 'passport'` on the line
  // above everything else, so the Passport toggle silently outranked the link
  // style someone had deliberately picked. A creator with 113 working Geniuslink
  // posts switched Passport on, and from that day MVP ignored his chooser, which
  // still said Geniuslink, and stopped using the Geniuslink account he pays for.
  // Co-Pilot then told him "your link style is Passport Links, change it in
  // Brand Profile" — pointing at a setting that already said what he wanted, so
  // there was no move he could make.
  //
  // A dropdown a person set is a decision. A toggle is a decision too, which is
  // why Passport still wins when the chooser is UNSET: someone who has never
  // touched it and switches Passport on plainly means to use it. What is not
  // acceptable is one silently overruling the other.
  if (stored === 'passport') return o.passportEligible ? 'passport' : 'direct'
  if (!stored) return o.passportEligible ? 'passport' : (o.hasGeniuslink ? 'geniuslink' : 'direct')
  let style = stored
  if (style === 'bitly' && !o.hasBitly) style = 'direct'
  if (style === 'geniuslink' && !o.hasGeniuslink) style = 'direct'
  if (style !== 'bitly' && style !== 'geniuslink' && style !== 'direct') style = 'direct'
  return style as LinkStyle
}
