// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE SANITIZER APPLIES THE RIGHT ESCAPE TO THE RIGHT FIELD.
//
// mvp_affiliate_sanitize_customizations walks the customizations payload and
// picks an escape per field by matching the KEY PATH. The match was:
//
//   #/(url|href|src|link|logo|image|photo|banner)#i
//
// unanchored, and matching a prefix anywhere in the path. Three consequences,
// all found on one creator's live site:
//
//   /footer/links/0/label   'link' is a prefix of 'links', so every footer
//                           LABEL went through esc_url_raw. 'About' became
//                           'http://About'; 'Affiliate Disclosure' became
//                           'http://Affiliate%20Disclosure'. The href beside it
//                           stayed correct, which is what made it look like a
//                           render bug: both templates already use esc_html on
//                           the label and always did. The value in the database
//                           was the mangled one.
//   /theme/linkColor        same prefix, and esc_url_raw on '#1a1a2e' returns
//                           something that is not a colour.
//   /profile/headshotUrl    NOT matched. No segment is a bare 'url', so a real
//                           URL got sanitize_text_field instead.
//
// The creator changed a label to "About Rob", watched it render as
// 'http://About%20Rob', and reasonably concluded the theme was prefixing the
// scheme. Then tried a re-save, a cache clear and a fresh edit. Re-saving was
// the thing applying it.
//
// This reads the REAL regex out of the PHP and runs key paths through it, so a
// future edit to that line is checked against the cases that broke rather than
// against a copy of the pattern kept in a test.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const PHP = readFileSync('wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php', 'utf8')

/** Pull a `preg_match('#...#i', $key_path)` pattern out of the sanitizer. */
function dispatchPattern(marker: string): RegExp | null {
  const fn = PHP.slice(PHP.indexOf('function mvp_affiliate_sanitize_customizations'))
  const body = fn.slice(0, fn.indexOf('\n    }\n}'))
  // Comments quote the OLD broken pattern by name, so they have to go first or
  // this test reads the bug it exists to prevent.
  const code = body.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const re = new RegExp(`preg_match\\('#([^']*${marker}[^']*)#i'`)
  const m = code.match(re)
  return m ? new RegExp(m[1], 'i') : null
}

const urlPattern = dispatchPattern('url')
check('the URL dispatch pattern is still findable', urlPattern !== null,
  'the sanitizer was restructured; this test is no longer checking anything')

if (urlPattern) {
  // Each case is a real key path from the customizations payload.
  const cases: Array<[string, boolean, string]> = [
    // THE BUG. A human-readable label is not a URL.
    ['/footer/links/0/label', false, 'esc_url_raw turns "About" into "http://About" on every footer on every site'],
    ['/footer/links/1/label', false, 'the index is not special; it was the word "links" that matched'],
    // Still has to catch the real URLs beside it.
    ['/footer/links/0/url', true, 'the href must still be escaped as a URL'],
    ['/profile/headshotUrl', true, 'a camelCase URL key was being MISSED, which is the same bug pointing the other way'],
    ['/profile/logoUrl', true, ''],
    ['/blocks/0/image', true, ''],
    ['/hero/bannerImage', true, ''],
    ['/blocks/0/src', true, ''],
    // Not URLs, and one of them is a colour esc_url_raw would destroy.
    ['/theme/linkColor', false, 'esc_url_raw on "#1a1a2e" does not return a colour'],
    ['/footer/bio', false, ''],
    ['/profile/authorName', false, ''],
    ['/footer/links/0/title', false, ''],
  ]
  for (const [path, shouldMatch, why] of cases) {
    const got = urlPattern.test(path)
    check(`${path} ${shouldMatch ? 'is' : 'is not'} treated as a URL`, got === shouldMatch, why)
  }

  // The property that makes the whole class of bug impossible: the decision is
  // about the LAST segment. A word appearing anywhere earlier in the path must
  // not decide the escape for a leaf beside it.
  check('a URL word earlier in the path does not capture its siblings',
    !urlPattern.test('/imageBlock/0/caption') && !urlPattern.test('/logo/0/altText'),
    'this is exactly how /footer/links/0/label was captured by "link"')
}

// Both templates escape the label as TEXT, and always did. Kept under test so a
// future "fix" to the render does not get applied to the innocent half.
{
  for (const f of [
    'wp-plugin/mvp-affiliate-theme/footer.php',
    'wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php',
  ]) {
    const src = readFileSync(f, 'utf8')
    check(`${f} escapes the footer label as text`, /esc_html\(\$link\['label'\]\)/.test(src),
      'esc_url on a label is what the stored value already suffered; doing it again at render would be twice')
    check(`${f} escapes the footer href as a URL`, /esc_url\(\$link\['url'\]\)/.test(src))
  }
}

if (failures.length) {
  console.error(`\n❌ customization-sanitizer: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ customization-sanitizer: a label is escaped as text and a URL as a URL, decided by the field itself rather than by a word anywhere in its path')
