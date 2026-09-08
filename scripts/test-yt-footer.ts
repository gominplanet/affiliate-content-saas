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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const ROUTE = readFileSync(join(root, 'app/api/youtube/generate-metadata/route.ts'), 'utf8')
const PAGE = readFileSync(join(root, 'app/(dashboard)/co-pilot/page.tsx'), 'utf8')

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** Everything the viewer actually sees, joined.
 *
 *  This helper used to join blogLine and collabLine only, because those were
 *  the two lines the module produced. The route ALSO pushed a third copy of the
 *  blog link higher up, which the module never saw, so a test whose entire
 *  point was "no URL twice" passed while a creator was looking at their address
 *  printed twice. The promoted line now belongs to the module, and to this
 *  join, which is the only way the rule can actually hold. */
const footer = (i: Parameters<typeof footerBlocks>[0]) => {
  const b = footerBlocks(i)
  return [b.promotedBlogLine, b.blogLine, b.collabLine].filter(Boolean).join('\n----------\n')
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

// ── Alejandro's report: the same blog URL, twice ────────────────────────────
// "And the website is still wrong. Is there a way I can edit the description?"
// His description carried both of MVP's blog lines: the arrow version under the
// disclosure and the fuller version below the sign-off. Both were MVP's, both
// were deliberate, and together they read as a mistake in his own description.
{
  const site = 'https://reviewcentralhub.com/'
  const f = footer({ websiteUrl: site, contactPreference: 'website', promoted: true })
  check('an affiliate description prints the blog URL once', urls(f).length === 1,
    `printed ${urls(f).length} times:\n${f}`)
  check('and it is the promoted one, above the fold', /👉/.test(f),
    'the high slot is the one worth having; the lower line stands down')
  check('the lower line does not also fire',
    !/make sure to check out my blog/.test(f))
}

// ── a description with no affiliate link still gets the blog line ───────────
// The promoted slot only exists under a disclosure. Without one, the fuller
// line further down is the only slot, and dropping it would lose the backlink.
{
  const f = footer({ websiteUrl: 'https://reviewcentralhub.com/', promoted: false })
  check('a non-affiliate description still links the blog', urls(f).length === 1, f)
  check('using the fuller line', /make sure to check out my blog/.test(f))
}

// ── the creator's own text wins ─────────────────────────────────────────────
// A creator who already links their site in their custom block does not need
// MVP adding it underneath. Two more copies of their own URL is clutter in
// someone else's description.
{
  const site = 'https://reviewcentralhub.com/'
  const own = 'Follow along at https://www.reviewcentralhub.com for the full archive.'
  const b = footerBlocks({ websiteUrl: site, contactPreference: 'website', promoted: true, existingText: own })
  check('MVP adds no blog line when the creator already wrote one',
    !b.promotedBlogLine && !b.blogLine,
    'www and a missing trailing slash are the same address to a reader')
  check('and the collaboration invitation survives', !!b.collabLine,
    'brands look for that line; suppressing the link must not suppress the invite')
  check('without repeating the URL', (b.collabLine!.match(/https?:\/\//g) || []).length === 0)
}

// ── the route prints the blog link from the module, not by hand ────────────
// The duplicate survived because the route pushed its own copy 20 lines above
// the module's. A test of the module could never have seen it.
{
  check('the route uses the module for the promoted line',
    /footer\.promotedBlogLine/.test(ROUTE))
  check('and no longer builds its own',
    !/`👉 For more in-depth reviews, check out my blog: \$\{websiteUrl\}`/.test(ROUTE),
    'a second hand-built copy is exactly what shipped the duplicate')
  check('the module is told whether the promoted slot exists',
    /promoted: !!affiliateUrl/.test(ROUTE))
  check('and what the creator already wrote',
    /existingText: customBlock/.test(ROUTE))
}

// ── a working setup is not dressed as a failure ────────────────────────────
// A creator using Passport with old Geniuslink keys on the account got an amber
// box and a warning triangle on EVERY generation, opening with "Geniuslink not
// used" and telling them to change a setting that was already right. Nothing
// was wrong. They reported the product as still broken, which is a fair reading
// of a warning triangle that never goes away.
{
  check('the server separates honoured from failed', /linkStyleHonoured/.test(ROUTE))
  check('the honoured message leads with what WAS used',
    /This description uses \$\{GOT_LABEL\[linkStyleUsed\]\}/.test(ROUTE),
    'opening with what was not used is what read as an error')
  check('and stops telling them to change a correct setting',
    !/working as chosen[\s\S]{0,120}Change it in Brand Profile/.test(ROUTE))
  check('the client renders it neutrally, with no warning triangle',
    /linkStyleHonoured[\s\S]{0,400}8e8e93/.test(PAGE)
    && /linkStyleHonoured\s*\n?\s*\? <>\{geniuslinkError\}<\/>/.test(PAGE),
    'same colour and triangle as a real failure is how a correct setup reads as broken')
  check('a real style failure keeps its warning', /ff9500/.test(PAGE))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
