// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SIX DEAD LINKS ON THE PAGE THAT EXISTS TO PROVE A PERSON IS REAL.
//
// From one creator's Search Console export of 586 not-found URLs:
//
//   /about-mvp-demo/instagram.com
//   /about-mvp-demo/facebook.com
//   /about-mvp-demo/pinterest.com
//   /about-mvp-demo/x.com
//   /about-mvp-demo/tiktok.com
//   /about-mvp-demo/youtube.com
//
// They type `instagram.com/handle`, because that is how people write a profile.
// A bare host in an href is a RELATIVE path, so it resolved under the About page
// and 404d, and Google crawled every one.
//
// The footer template already handled this:
//
//   var href = s.url.startsWith('http') ? s.url : 'https://' + s.url
//
// and the About template did not. One rule, two templates, one of them wrong.
//
// Three ways a fix here does fresh harm, all pinned below:
//
//   mailto: broken      prefixing a contact link with https:// to fix a social
//                       one trades a working link for a dead one
//   a real path mangled somebody linking /about/ means THEIR /about/, and
//                       https://about/ is not a place
//   an empty field      rendering an anchor to nothing is worse than no anchor
import { absoluteUrl } from '../lib/absolute-url'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── THE EXACT CASE, from the export ───────────────────────────────────────
{
  for (const host of ['instagram.com', 'facebook.com', 'pinterest.com', 'x.com', 'tiktok.com', 'youtube.com']) {
    const out = absoluteUrl(host)
    check(`${host} becomes absolute`, out === `https://${host}`, String(out))
    check(`${host} is not a relative path any more`, !!out && !out.startsWith(host), String(out))
  }
  check('a bare host with a path works too',
    absoluteUrl('instagram.com/gominreviews') === 'https://instagram.com/gominreviews')
  check('and one with a leading @ handle in the path',
    absoluteUrl('tiktok.com/@somebody') === 'https://tiktok.com/@somebody')
  check('whitespace does not defeat it',
    absoluteUrl('  youtube.com/@chan  ') === 'https://youtube.com/@chan')
}

// ── already absolute is left exactly alone ────────────────────────────────
{
  for (const u of [
    'https://instagram.com/x',
    'http://example.com/y',
    'HTTPS://Example.com/Z',
  ]) {
    check(`untouched: ${u}`, absoluteUrl(u) === u, String(absoluteUrl(u)))
  }
  check('protocol-relative gains https, not a second slash',
    absoluteUrl('//cdn.example.com/a') === 'https://cdn.example.com/a',
    String(absoluteUrl('//cdn.example.com/a')))
}

// ── the schemes that must never be rewritten ──────────────────────────────
{
  check('mailto survives', absoluteUrl('mailto:me@example.com') === 'mailto:me@example.com')
  check('tel survives', absoluteUrl('tel:+15551234') === 'tel:+15551234')
  check('a bare email becomes mailto, not https',
    absoluteUrl('me@example.com') === 'mailto:me@example.com',
    String(absoluteUrl('me@example.com')))
}

// ── a deliberate site-relative path stays relative ────────────────────────
{
  check('/about/ stays /about/', absoluteUrl('/about/') === '/about/',
    'https://about/ is not a place, and they meant their own page')
  check('/contact stays put', absoluteUrl('/contact') === '/contact')
}

// ── empty is null, so the caller drops the link ───────────────────────────
{
  for (const v of [null, undefined, '', '   ']) {
    check(`empty (${JSON.stringify(v)}) is null`, absoluteUrl(v) === null, String(absoluteUrl(v)))
  }
}

// ── AND THE ABOUT PAGE USES IT ────────────────────────────────────────────
//
// A helper nothing calls leaves every creator's About page exactly as it was.
{
  const strip = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

  const about = strip(readFileSync('lib/wordpress-about-template.ts', 'utf8'))

  check('the About template imports it', /from '@\/lib\/absolute-url'/.test(about))
  check('and every social link goes through it', /const href = absoluteUrl\(raw\)/.test(about),
    'one that does not is one more relative link on a live page')
  check('the raw values are no longer put straight into an href',
    !/href="\$\{esc\((youtubeUrl|instagramUrl|tiktokUrl|twitterUrl|pinterestUrl|facebookUrl)\)\}"/.test(about),
    'that is the exact shape that produced the six 404s')
  check('an empty field renders no anchor at all', /if \(href\) socials\.push/.test(about),
    'an anchor pointing at nothing is worse than no anchor')

  // Six platforms in, six out. A silently dropped one would be a link the
  // creator filled in and never sees on the page.
  const calls = (about.match(/\n\s+social\(/g) ?? []).length
  check('all six platforms are still rendered', calls === 6, `found ${calls}`)
}

if (failures.length) {
  console.error(`\n❌ absolute-url: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ absolute-url: a creator-typed host becomes a real link, and mailto and real paths are left alone')
