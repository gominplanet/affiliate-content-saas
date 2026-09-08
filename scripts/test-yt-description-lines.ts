// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A creator's wording, kept — without learning the wrong things.
//
// "And the website is still wrong. Is there a way I can edit the description?"
// He could, once. The Co-Pilot box is editable and his edit is what gets
// pushed, but nothing kept it, so the same boilerplate came back on the next
// video and he retyped the fix. The only durable control APPENDED to the
// description; MVP's own lines were hard-coded in a route.
//
// The dangerous way to fix that is to diff what was pushed against what was
// generated and persist the difference. A YouTube description mixes boilerplate
// with per-video content: the product name, the ASIN, the hashtags. A diff
// would happily learn "RGBW Ocean Wave Aurora Projector Lamp" as part of every
// future description, and the creator would have no idea why.
//
// So detection is exact-match against the lines MVP knows it emitted, never a
// diff. That is what most of this file is about: the things it must NOT offer
// to save.
import {
  DEFAULT_LINES, LINE_KEYS, resolveLine, fillTokens, descriptionLines,
  detectLineEdit, disclosureIsValid,
} from '../lib/yt-description-lines'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const VALUES = { shop: 'AMAZON', link: 'https://mvpl.ink/x7k', site: 'https://reviewcentralhub.com/', email: 'alex@example.com' }

// ── defaults are the old hard-coded strings ────────────────────────────────
// If these drift, every creator who has not set their own gets silently
// restyled copy on their channel.
{
  check('the Amazon disclosure is unchanged',
    DEFAULT_LINES.disclosureProduct === 'Disclosure: As an Amazon Associate and Influencer I earn commissions, at no cost to you, made out of qualifying purchases.')
  check('the sign-off is unchanged',
    DEFAULT_LINES.signOff.startsWith('Thank you for watching!'))
  check('every line has a default', LINE_KEYS.every((k) => !!DEFAULT_LINES[k]))
}

// ── overrides ──────────────────────────────────────────────────────────────
{
  check('a set line is used', resolveLine('signOff', { signOff: 'Cheers, see you next week.' }) === 'Cheers, see you next week.')
  check('an unset line falls back', resolveLine('signOff', {}) === DEFAULT_LINES.signOff)
  check('a cleared box asks for the default back', resolveLine('signOff', { signOff: '   ' }) === DEFAULT_LINES.signOff,
    'an empty textarea means "give me yours", not "print nothing"')
  check('a null override object is fine', resolveLine('signOff', null) === DEFAULT_LINES.signOff)
}

// ── tokens ─────────────────────────────────────────────────────────────────
{
  const filled = fillTokens('Buy on {shop}: {link}', VALUES)
  check('tokens fill', filled === 'Buy on AMAZON: https://mvpl.ink/x7k')
  check('an unknown token is left visible', fillTokens('Hi {shopp}', VALUES) === 'Hi {shopp}',
    'blanking it silently would leave a gap the creator cannot explain')
  const all = descriptionLines({}, VALUES)
  check('the blog line carries the site', all.blogPromoted.includes(VALUES.site))
  check('the CTA carries the link', all.affiliateCta.includes(VALUES.link))
}

// ── the disclosure has to keep disclosing ──────────────────────────────────
// Amazon's Operating Agreement and the FTC both require it. This is the one
// line where a creator's freedom meets someone else's rules, and MVP would be
// the one that wrote the gutted version on their behalf.
{
  check('a real disclosure passes', disclosureIsValid(DEFAULT_LINES.disclosureProduct))
  check('a reworded but honest one passes',
    disclosureIsValid('Heads up: some links here are affiliate links and I may earn a commission.'))
  check('an empty one fails', !disclosureIsValid(''))
  check('a gutted one fails', !disclosureIsValid('Thanks for watching!'))
  check('and the default stands when it fails',
    resolveLine('disclosureProduct', { disclosureProduct: 'Thanks for watching!' }) === DEFAULT_LINES.disclosureProduct,
    'MVP must not publish a description that stopped disclosing')
  check('a valid rewrite is honoured',
    resolveLine('disclosureGeneral', { disclosureGeneral: 'Some links are affiliate links; I may earn a commission.' })
      === 'Some links are affiliate links; I may earn a commission.')
}

// ── detection: what it SHOULD offer ────────────────────────────────────────
{
  const lines = descriptionLines({}, VALUES)
  const generated = [lines.affiliateCta, lines.affiliateLabel, '----------', lines.disclosureProduct, '----------', lines.signOff].join('\n')
  const edited = generated.replace(lines.signOff, 'Cheers! Subscribe if this helped.')
  const hit = detectLineEdit(generated, edited, {}, VALUES)
  check('a rewritten sign-off is detected', hit?.key === 'signOff', JSON.stringify(hit))
  check('and carries their new words', hit?.text === 'Cheers! Subscribe if this helped.')
}

// ── detection: the tokens go back in ───────────────────────────────────────
// Saving the literal URL would freeze it. When they change their site next
// month the stored line would still point at the old one.
{
  const lines = descriptionLines({}, VALUES)
  const generated = [lines.blogPromoted, '----------', lines.signOff].join('\n')
  const edited = generated.replace(lines.blogPromoted, `Read the full write-ups at ${VALUES.site}`)
  const hit = detectLineEdit(generated, edited, {}, VALUES)
  check('the blog line is detected', hit?.key === 'blogPromoted')
  check('and the URL is stored as a token', hit?.text === 'Read the full write-ups at {site}',
    'storing the literal address freezes it to today')
}

// ── detection: what it MUST NOT offer ──────────────────────────────────────
// The whole reason this is exact-match and not a diff.
{
  const lines = descriptionLines({}, VALUES)
  const generated = [
    lines.affiliateCta,
    '----------',
    'RGBW Ocean Wave Aurora Projector Lamp — full review',
    '#ad #affiliate #projector',
    '----------',
    lines.signOff,
  ].join('\n')

  check('editing the product line offers nothing',
    detectLineEdit(generated, generated.replace('RGBW Ocean Wave Aurora Projector Lamp — full review', 'Ocean Wave Projector — honest review'), {}, VALUES) === null,
    'a product name learned as a template would appear on every future video')
  check('editing hashtags offers nothing',
    detectLineEdit(generated, generated.replace('#ad #affiliate #projector', '#ad #affiliate #lamp'), {}, VALUES) === null)
  check('adding a line offers nothing',
    detectLineEdit(generated, generated + '\nOne more thought.', {}, VALUES) === null,
    'structural changes are not a template rewrite')
  check('deleting a line offers nothing',
    detectLineEdit(generated, generated.split('\n').slice(0, -1).join('\n'), {}, VALUES) === null)
  check('an untouched description offers nothing', detectLineEdit(generated, generated, {}, VALUES) === null)
  check('blanking a boilerplate line offers nothing',
    detectLineEdit(generated, generated.replace(lines.signOff, ''), {}, VALUES) === null,
    'deleting a line is a different intent from rewriting it')
  check('an empty description offers nothing', detectLineEdit(generated, '', {}, VALUES) === null)
}

// ── detection: a gutted disclosure is never offered ────────────────────────
{
  const lines = descriptionLines({}, VALUES)
  const generated = [lines.disclosureProduct, '----------', lines.signOff].join('\n')
  const edited = generated.replace(lines.disclosureProduct, 'Enjoy the video!')
  check('rewriting the disclosure into nothing is not offered',
    detectLineEdit(generated, edited, {}, VALUES) === null,
    'offering to save it would be offering to break their Amazon account')
}

// ── detection compares against THEIR current wording ───────────────────────
// Once a line is saved, the next generation emits their version, so that is
// what a further edit must be measured against.
{
  const overrides = { signOff: 'Cheers, see you next week.' }
  const lines = descriptionLines(overrides, VALUES)
  const generated = [lines.affiliateCta, '----------', lines.signOff].join('\n')
  check('their saved line is what MVP emitted', generated.includes('Cheers, see you next week.'))
  const hit = detectLineEdit(generated, generated.replace('Cheers, see you next week.', 'Cheers, back Thursday.'), overrides, VALUES)
  check('and editing it again is still detected', hit?.key === 'signOff' && hit.text === 'Cheers, back Thursday.')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
