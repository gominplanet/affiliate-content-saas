// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The lines MVP writes into every YouTube description, and the creator's right
// to change them.
//
// A creator reported his blog URL printed twice and asked "is there a way I can
// edit the description?". He could, once: the Co-Pilot has a textarea and his
// edit is what gets pushed. Nothing kept it. The next video brought the same
// boilerplate back and he fixed it by hand again, every video, for ever.
//
// The only durable lever he had was youtube_description_block, which APPENDS.
// He could add lines. He could not change MVP's: the disclosure, the blog
// backlink wording, the sign-off, the collaboration line. So when MVP's
// boilerplate was wrong there was no way around it, which is why one duplicated
// URL turned into a support thread instead of a shrug.
//
// This module is the whole set of those lines in one place, with the creator's
// override applied where they have set one. Defaults are byte-identical to what
// the route hard-coded before it, so nobody's descriptions change until they
// choose to change them.
//
// TOKENS, not string interpolation the creator has to get right. A line says
// {link} or {site} and this fills it in. A creator who deletes a token loses
// that value from their description, which is their call, but they cannot
// produce a broken template or reach anything MVP did not offer them.

/** Every line a creator may rewrite. Per-video content — the affiliate URL, the
 *  hashtags, the product description, the ASIN — is deliberately NOT here: that
 *  is generated per video and is not boilerplate to template. */
export const LINE_KEYS = [
  'affiliateCta',
  'affiliateLabel',
  'disclosureProduct',
  'disclosureGeneral',
  'blogPromoted',
  'blogFull',
  'collabWebsite',
  'collabEmail',
  'collabNoLink',
  'signOff',
] as const

export type LineKey = (typeof LINE_KEYS)[number]

/** Exactly what the route produced before any of this existed. Changing one of
 *  these changes it for every creator who has not set their own, so they are
 *  worth treating as published copy rather than strings. */
export const DEFAULT_LINES: Record<LineKey, string> = {
  affiliateCta: "Check Today's Price and Availability on {shop} here: {link}",
  affiliateLabel: '(affiliate link)',
  disclosureProduct: 'Disclosure: As an Amazon Associate and Influencer I earn commissions, at no cost to you, made out of qualifying purchases.',
  disclosureGeneral: 'Disclosure: This video contains affiliate links. I may earn a commission at no extra cost to you.',
  blogPromoted: '👉 For more in-depth reviews, check out my blog: {site}',
  blogFull: 'For more in depth reviews, make sure to check out my blog: {site}',
  collabWebsite: "Let's Work Together! Check my WEBSITE for collaborations: {site}",
  collabEmail: "Let's Work Together! Email me for collaborations: {email}",
  collabNoLink: "Let's Work Together! Brand collaborations welcome — reach me through the website linked above.",
  signOff: 'Thank you for watching! If you enjoyed this video review and found it useful, please subscribe and like for more product reviews :)',
}

/** What each line is for, and which tokens it may use. Drives the settings UI
 *  so a creator is never guessing what {shop} will become. */
export const LINE_META: Record<LineKey, { label: string; help: string; tokens: string[] }> = {
  affiliateCta: { label: 'Product link line', help: 'The call to action above your affiliate link.', tokens: ['{shop}', '{link}'] },
  affiliateLabel: { label: 'Affiliate link label', help: 'The short label under the product link.', tokens: [] },
  disclosureProduct: { label: 'Disclosure (Amazon)', help: 'Shown on Amazon product videos. Required by Amazon and the FTC.', tokens: [] },
  disclosureGeneral: { label: 'Disclosure (other links)', help: 'Shown when the link is not an Amazon product. Required by the FTC.', tokens: [] },
  blogPromoted: { label: 'Blog link (top)', help: 'Sits high in the description, above the fold, on videos with a product link.', tokens: ['{site}'] },
  blogFull: { label: 'Blog link (lower)', help: 'Used instead of the top one on videos with no product link.', tokens: ['{site}'] },
  collabWebsite: { label: 'Collaboration line (website)', help: 'Used when brands should reach you via your site.', tokens: ['{site}'] },
  collabEmail: { label: 'Collaboration line (email)', help: 'Used when brands should email you.', tokens: ['{email}'] },
  collabNoLink: { label: 'Collaboration line (no repeat)', help: 'Used when your site is already linked above, so the address is not printed twice.', tokens: [] },
  signOff: { label: 'Sign-off', help: 'The thank-you and subscribe line.', tokens: [] },
}

/** A disclosure has to keep disclosing.
 *
 *  Amazon's Operating Agreement and the FTC both require it, and it is the one
 *  line where a creator's freedom to edit runs into someone else's rules. An
 *  empty or gutted disclosure is not a preference, it is an account risk that
 *  MVP would have written on their behalf. So an override that no longer reads
 *  as a disclosure is refused and the default stands. */
export function disclosureIsValid(text: string): boolean {
  const s = String(text || '').toLowerCase()
  if (s.trim().length < 20) return false
  const saysPaid = /(commission|affiliate|paid link|earn|compensat)/.test(s)
  return saysPaid
}

export interface LineOverrides { [key: string]: unknown }

/** The creator's version of a line, or MVP's.
 *
 *  Whitespace-only counts as unset rather than as "print nothing", because a
 *  cleared textarea is how someone asks for the default back. Deliberately
 *  removing a line is a separate control in the UI, not an empty string. */
export function resolveLine(key: LineKey, overrides: LineOverrides | null | undefined): string {
  const raw = overrides && typeof overrides[key] === 'string' ? String(overrides[key]) : ''
  const custom = raw.trim()
  if (!custom) return DEFAULT_LINES[key]
  if ((key === 'disclosureProduct' || key === 'disclosureGeneral') && !disclosureIsValid(custom)) {
    return DEFAULT_LINES[key]
  }
  return custom
}

/** Fill the tokens. Unknown tokens are left alone rather than blanked, so a
 *  creator seeing "{shopp}" in their description can spot their own typo
 *  instead of finding a silent gap. */
export function fillTokens(line: string, values: { shop?: string; link?: string; site?: string; email?: string }): string {
  return line
    .replace(/\{shop\}/g, values.shop ?? '')
    .replace(/\{link\}/g, values.link ?? '')
    .replace(/\{site\}/g, values.site ?? '')
    .replace(/\{email\}/g, values.email ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** One call for the route: every line, resolved and filled. */
export function descriptionLines(
  overrides: LineOverrides | null | undefined,
  values: { shop?: string; link?: string; site?: string; email?: string },
): Record<LineKey, string> {
  const out = {} as Record<LineKey, string>
  for (const key of LINE_KEYS) out[key] = fillTokens(resolveLine(key, overrides), values)
  return out
}

/** Which line a creator rewrote, by comparing what MVP produced against what
 *  they pushed. Used to offer "save this as your default" rather than guessing
 *  from a diff: MVP knows the exact string it emitted, so a match is certain
 *  and there is nothing to infer.
 *
 *  Returns the key and their new text, or null when nothing recognisable
 *  changed. Per-video content is never a candidate, because only these ten
 *  lines are ever compared. */
export function detectLineEdit(
  generated: string,
  edited: string,
  overrides: LineOverrides | null | undefined,
  values: { shop?: string; link?: string; site?: string; email?: string },
): { key: LineKey; text: string } | null {
  if (!generated.trim() || !edited.trim() || generated === edited) return null
  const genLines = generated.split('\n')
  const editLines = edited.split('\n')
  // Same number of lines means a straight in-place rewrite, which is what
  // editing a sentence looks like. Anything structural (lines added or removed)
  // is not a template change and is left alone.
  if (genLines.length !== editLines.length) return null

  const resolved = descriptionLines(overrides, values)
  for (let i = 0; i < genLines.length; i++) {
    if (genLines[i] === editLines[i]) continue
    const before = genLines[i].trim()
    const after = editLines[i].trim()
    if (!after) return null
    const key = (LINE_KEYS as readonly LineKey[]).find((k) => resolved[k] === before)
    if (!key) return null
    // Put the tokens back, so saving "check my blog: https://x.com" stores
    // "check my blog: {site}" and keeps working if they change their site.
    let text = after
    for (const [token, value] of [['{link}', values.link], ['{site}', values.site], ['{email}', values.email], ['{shop}', values.shop]] as const) {
      if (value && text.includes(value)) text = text.split(value).join(token)
    }
    if ((key === 'disclosureProduct' || key === 'disclosureGeneral') && !disclosureIsValid(text)) return null
    return { key, text }
  }
  return null
}
