// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MOVE OUR PICTURES ONTO THE CREATOR'S SITE. MOVE NOTHING ELSE.
//
// When a site refuses a media upload the generator embeds the URL it generated
// the picture from, so the article still reads properly. Six creators are
// carrying 186 posts like that, and fal's documentation is blunt about what it
// costs: "Expired files are permanently deleted and cannot be recovered."
// Retention is published as "Configurable" with no default, and MVP does not
// send the lifecycle header, so nobody can say how long those posts have.
//
// The repair is simple and the SELECTION is where it can go wrong, in two
// opposite ways:
//
//   move too little   the post keeps depending on our CDN and the repair looks
//                     like it ran while changing nothing
//   move too much     somebody else's files get copied onto a creator's server.
//                     Amazon's product photos are pointed at deliberately, and
//                     a creator's YouTube thumbnails are Google's to serve.
//
// So the rule is pinned here rather than left inside the route, where it could
// only be checked by having a broken site to hand.
import {
  findRehostable,
  replaceImageUrl,
  isOwnHost,
  isOurGeneratedHost,
  describeRehost,
  NOT_OURS,
} from '../lib/rehost-images'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const SITE = 'https://jdtheot.com'
const img = (src: string) => `<figure class="wp-block-image"><img src="${src}" alt="x"/></figure>`

// ── what gets moved ───────────────────────────────────────────────────────
{
  const html = img('https://v3b.fal.media/files/b/0aaa7516/J2S3XYBh_m9AjxmNhjPxE_1789432544362.png')
  const found = findRehostable(html, SITE)
  check('a picture on our generation CDN is moved', found.length === 1, JSON.stringify(found))
  check('and the URL comes back intact',
    found[0]?.url.endsWith('_1789432544362.png'), found[0]?.url)

  check('fal.run counts too', findRehostable(img('https://fal.run/files/x.jpg'), SITE).length === 1)
  check('and a subdomain of it', findRehostable(img('https://v3.fal.media/y.png'), SITE).length === 1)
}

// ── what is deliberately left alone ───────────────────────────────────────
//
// This half is the one that can do damage. Copying Amazon's product photos onto
// a creator's blog is not a repair, it is a liability we would be creating on
// their server.
{
  // Driven off the documented list, so adding a host there without proving it
  // is excluded is impossible.
  for (const { host, why } of NOT_OURS) {
    check(`left alone: ${why}`, findRehostable(img(`https://${host}/a.jpg`), SITE).length === 0, host)
    check(`and ${host} is not treated as ours`, !isOurGeneratedHost(host))
  }

  const cases: Array<[string, string]> = [
    ['https://jdtheot.com/wp-content/uploads/2026/09/x.jpg', 'already on their own site'],
    ['https://www.jdtheot.com/wp-content/uploads/2026/09/y.jpg', 'their own site with www'],
    ['data:image/png;base64,iVBORw0KGgo=', 'an inline image'],
    ['/wp-content/uploads/relative.jpg', 'a relative path, already local'],
    ['ftp://example.com/x.jpg', 'not an http URL'],
  ]
  for (const [url, why] of cases) {
    check(`left alone: ${why}`, findRehostable(img(url), SITE).length === 0, url)
  }

  // THE CHECK THE FIRST VERSION COULD NOT MAKE. The module used to carry both a
  // deny-list and an allow-list, and each covered for the other: deleting
  // either changed no behaviour, so neither could be tested. A third-party host
  // that appears on NEITHER list is what separates them, and it must not move.
  for (const host of ['cdn.example.com', 'images.contentful.com', 'files.wordpress.com', 'lh3.googleusercontent.com']) {
    check(`an unlisted third party is left alone: ${host}`,
      findRehostable(img(`https://${host}/a.jpg`), SITE).length === 0,
      'the rule is an allow-list of OUR hosts; anything else copies somebody else\'s files onto a creator server')
  }

  // And the mix, which is what a real post looks like.
  const real = [
    img('https://i.ytimg.com/vi/abc/maxresdefault.jpg'),
    img('https://v3b.fal.media/files/b/one.png'),
    img('https://m.media-amazon.com/images/I/71abc.jpg'),
    img('https://v3b.fal.media/files/b/two.png'),
    img('https://jdtheot.com/wp-content/uploads/x.jpg'),
  ].join('\n')
  const found = findRehostable(real, SITE)
  check('a real post moves only ours', found.length === 2, found.map(f => f.url).join(', '))
  check('and never Amazon', !found.some(f => /amazon/i.test(f.url)))
  check('and never YouTube', !found.some(f => /ytimg/i.test(f.url)))
}

// ── the same picture twice is one move ────────────────────────────────────
{
  const url = 'https://v3b.fal.media/files/b/dup.png'
  const html = [img(url), '<p>text</p>', img(url)].join('\n')
  const found = findRehostable(html, SITE)
  check('a repeated picture is listed once', found.length === 1, String(found.length))
  check('and its count is recorded', found[0]?.occurrences === 2, String(found[0]?.occurrences))
}

// ── isOwnHost is not fooled ───────────────────────────────────────────────
//
// A sloppy version of this check would treat a lookalike domain as the
// creator's own and skip a picture that does need moving.
{
  check('exact host matches', isOwnHost('https://jdtheot.com/a.jpg', SITE))
  check('www does not break it', isOwnHost('https://www.jdtheot.com/a.jpg', SITE))
  check('and the other direction', isOwnHost('https://jdtheot.com/a.jpg', 'https://www.jdtheot.com'))
  check('a lookalike is NOT their site', !isOwnHost('https://jdtheot.com.evil.net/a.jpg', SITE),
    'a suffix match here would skip a picture that needs moving and call it done')
  check('a different site is not theirs',
    !isOwnHost('https://sleepinggiantproductreviews.com/a.jpg', SITE))
  check('rubbish in does not throw', !isOwnHost('not a url', SITE))
}

// ── the rewrite swaps every copy and nothing else ─────────────────────────
{
  const from = 'https://v3b.fal.media/files/b/0aaa/a+b(c).png?x=1&y=2'
  const to = 'https://jdtheot.com/wp-content/uploads/a.png'
  const html = [img(from), img(from), img('https://v3b.fal.media/files/b/other.png')].join('\n')
  const out = replaceImageUrl(html, from, to)
  check('both copies are swapped', out.split(to).length - 1 === 2, out)
  check('the original is gone', !out.includes(from))
  check('the other picture is untouched', out.includes('other.png'))
  check('a URL with regex characters survives', out.includes(to),
    'building a RegExp from a URL is how a rewrite matches the wrong thing or nothing')
  check('replacing with itself changes nothing', replaceImageUrl(html, from, from) === html)
  check('an empty from changes nothing', replaceImageUrl(html, '', to) === html)
}

// ── the report tells the three outcomes apart ─────────────────────────────
//
// The one that matters: every picture failing is a site still refusing uploads.
// Telling that person "0 moved" reads as the tool being broken rather than
// their site still being blocked, and they would come back tomorrow.
{
  const refused = describeRehost(0, [{ url: 'x', reason: '403' }, { url: 'y', reason: '403' }], 2)
  check('nothing moved is reported as a refusal', refused.outcome === 'refused', refused.outcome)
  check('and names the site as the cause', /your site would not accept/i.test(refused.headline), refused.headline)
  check('and points at the picture test', /picture test/i.test(refused.headline), refused.headline)
  check('and does not read as success', !/moved \d+ pictures onto/i.test(refused.headline))

  const all = describeRehost(3, [], 3)
  check('a clean run says how many', /moved 3 pictures/i.test(all.headline), all.headline)
  check('and says what it bought them', /no longer depend/i.test(all.headline), all.headline)
  check('one picture is singular', /moved 1 picture onto/i.test(describeRehost(1, [], 1).headline))

  const partial = describeRehost(2, [{ url: 'z', reason: '413' }], 3)
  check('a partial run admits the gap', /moved 2 of 3/i.test(partial.headline), partial.headline)
  check('and does not round up to success', partial.failed.length === 1)

  const none = describeRehost(0, [], 0)
  check('nothing to do is its own outcome', none.outcome === 'nothing-to-do', none.outcome)
  check('and is NOT reported as a refusal', none.outcome !== 'refused',
    'a creator whose posts are already fine must not be told their site refused something')
  check('and says so plainly', /already on your own site/i.test(none.headline), none.headline)
}

// ── house style ───────────────────────────────────────────────────────────
{
  const lines = [
    describeRehost(0, [{ url: 'x', reason: 'r' }], 2).headline,
    describeRehost(3, [], 3).headline,
    describeRehost(2, [{ url: 'z', reason: 'r' }], 3).headline,
    describeRehost(0, [], 0).headline,
  ]
  for (const l of lines) {
    check(`no dash punctuation in "${l.slice(0, 40)}…"`, !/[—–]|\s-\s/.test(l))
    check(`no year in "${l.slice(0, 40)}…"`, !/\b20\d{2}\b/.test(l))
  }
}

if (failures.length) {
  console.error(`\n❌ rehost-images: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ rehost-images: only the pictures MVP generated are moved, and every copy of them')
