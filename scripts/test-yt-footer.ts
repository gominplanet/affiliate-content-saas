// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The footer, read the way a viewer reads it: as one block of text.
//
// Two independent builders both fell back to the same Brand Profile field, so a
// creator whose collaboration contact is their website got the URL printed
// twice, three lines apart. Neither builder was wrong on its own. It was only
// visible in the assembled description, which is the same reason the thumbnail
// contradictions survived four rounds of fixes.
//
// So the rule under test is about the finished footer, not about either line:
// no URL may appear twice, and every creator still gets an invitation to work
// with them, because that line is what brands look for.
import { footerBlocks, sameUrl } from '../lib/yt-description-footer'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** Everything the viewer actually sees, joined. */
const footer = (i: Parameters<typeof footerBlocks>[0]) => {
  const b = footerBlocks(i)
  return [b.blogLine, b.collabLine].filter(Boolean).join('\n----------\n')
}
const urls = (s: string) => (s.match(/https?:\/\/\S+/g) || []).map(u => u.replace(/\/+$/, '').toLowerCase())

// ── the exact report ────────────────────────────────────────────────────────
{
  const f = footer({ websiteUrl: 'https://reviewcentralhub.com/', contactPreference: 'website' })
  const found = urls(f)
  check('the website appears exactly once', found.length === 1, f)
  check('the blog backlink survives', /check out my blog/.test(f), f)
  check('and so does the invitation to work together', /Let's Work Together/.test(f), f)
  check('the collab line no longer repeats the address',
    !/Check my WEBSITE for collaborations: https/.test(f), f)
}

// ── a creator with both routes gets both ────────────────────────────────────
// This is the better outcome, not just the non-duplicated one: the website and
// the email are two different ways to reach them and both were being collapsed
// into one.
{
  const f = footer({ websiteUrl: 'https://reviewcentralhub.com/', contactEmail: 'me@x.com' })
  check('the site appears once', urls(f).length === 1, f)
  check('and the collab line uses the email instead', /me@x\.com/.test(f), f)
}

// ── an explicit preference is still honoured ────────────────────────────────
{
  const emailPref = footer({ websiteUrl: 'https://x.com/', contactEmail: 'me@x.com', contactPreference: 'email' })
  check('preference email wins over the website', /Email me for collaborations: me@x\.com/.test(emailPref), emailPref)
  check('and the site still appears once for the blog line', urls(emailPref).length === 1, emailPref)

  // Preference 'website' with an email on file: the creator asked for the
  // website, so we do NOT quietly switch them to email. We just stop repeating.
  const sitePref = footer({ websiteUrl: 'https://x.com/', contactEmail: 'me@x.com', contactPreference: 'website' })
  check('preference website is not overridden by the email', !/me@x\.com/.test(sitePref), sitePref)
  check('and it still says it only once', urls(sitePref).length === 1, sitePref)
}

// ── the cases that must not lose anything ───────────────────────────────────
{
  const emailOnly = footer({ contactEmail: 'me@x.com' })
  check('email only still invites collaboration', /Let's Work Together/.test(emailOnly) && /me@x\.com/.test(emailOnly), emailOnly)
  check('and prints no blog line', !/check out my blog/.test(emailOnly), emailOnly)

  const siteOnly = footerBlocks({ websiteUrl: 'https://x.com' })
  check('website only still gets a blog line', !!siteOnly.blogLine)
  check('and still gets a collab invitation', !!siteOnly.collabLine)

  const nothing = footerBlocks({})
  check('an empty profile produces no footer at all',
    nothing.blogLine === null && nothing.collabLine === null)
  check('nothing renders as undefined',
    !/undefined|null/.test(footer({ websiteUrl: 'https://x.com' })))
}

// ── the same address written differently is still the same address ──────────
// Without this, "https://x.com/" in one field and "http://www.x.com" in the
// other reads as two links to a comparison and as one duplicate to a human.
{
  check('trailing slash', sameUrl('https://x.com/', 'https://x.com'))
  check('www', sameUrl('https://www.x.com', 'https://x.com'))
  check('scheme', sameUrl('http://x.com', 'https://x.com'))
  check('case', sameUrl('https://X.COM/', 'https://x.com'))
  check('different sites are different', !sameUrl('https://x.com', 'https://y.com'))
  check('empty matches nothing', !sameUrl('', '') && !sameUrl(null, undefined))

  const f = footer({ websiteUrl: 'http://www.reviewcentralhub.com', contactPreference: 'website' })
  check('and the dedupe uses it', urls(f).length === 1, f)
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
