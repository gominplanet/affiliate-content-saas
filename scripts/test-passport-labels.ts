// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The Passport dashboard, read as a report rather than as a log.
//
// Every case here is something a real account actually displayed. They are not
// rendering accidents: each is a raw stored value shown unchanged, which is
// correct in a log and wrong on a page a creator uses to decide where their
// money comes from.
import {
  sourceLabel, cleanProductLabel, countryName, countryFlag,
  isYouTubeVideoId, coverage, coverageNote,
} from '../lib/passport-analytics-labels'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── "WHERE CLICKS CAME FROM: Vhj3WN1cu6U 91" ────────────────────────────────
{
  const titles = new Map([['Vhj3WN1cu6U', 'I Tested 5 Guitar Pedals']])
  check('a known video shows its title', sourceLabel('Vhj3WN1cu6U', titles) === 'I Tested 5 Guitar Pedals')
  check('an unknown video is still readable and still traceable',
    sourceLabel('C0QWUJCzoI8', titles) === 'YouTube video C0QWUJCzoI8',
    'a bare id reads as noise; the id still has to be there to look up')
  check('blog is named', sourceLabel('blog') === 'Blog')
  check('direct is named', sourceLabel('direct') === 'Direct')
  check('an empty source is Direct', sourceLabel(null) === 'Direct' && sourceLabel('') === 'Direct')
  check('a referrer host loses its www', sourceLabel('www.pinterest.com') === 'pinterest.com')

  check('an 11-char id is a video', isYouTubeVideoId('4J1TIvw6-fY'))
  check('but a word is not', !isYouTubeVideoId('blog') && !isYouTubeVideoId('direct'))
  check('and neither is a hostname', !isYouTubeVideoId('pinterest.com'))
  check('nor the wrong length', !isYouTubeVideoId('abc') && !isYouTubeVideoId('A'.repeat(12)))
}

// ── "TOP PRODUCTS: Amazon.com: La Roche-Posay Effaclar A.Z. ... | Salic..." ──
{
  check('the marketplace prefix goes',
    cleanProductLabel('Amazon.com: La Roche-Posay Effaclar A.Z. Acne Face Gel with Azelaic Acid, 1.35oz | Salicylic Acid')
      === 'La Roche-Posay Effaclar A.Z. Acne Face Gel with Azelaic Acid, 1.35oz')
  check('other marketplaces too',
    cleanProductLabel('Amazon.co.uk: SYMYNELEC Security Cameras Wireless Outdoor') === 'SYMYNELEC Security Cameras Wireless Outdoor')
  check('a keyword tail after a pipe is dropped',
    cleanProductLabel('Flatsons KE1 Multi-Effects Guitar Pedal | 60+ FX | 20 Amps') === 'Flatsons KE1 Multi-Effects Guitar Pedal')
  check('but a short name before a pipe is NOT amputated',
    cleanProductLabel('KE1 | Multi-Effects Guitar Pedal, 60+ FX').startsWith('KE1 |'),
    'trimming at the pipe would leave three characters as the product name')
  check('whitespace is normalised', cleanProductLabel('  Foo   Bar  ') === 'Foo Bar')
  check('an empty label falls back to the ASIN',
    cleanProductLabel('', 'B0H298X69Z') === 'Product B0H298X69Z')
  check('and to something readable with no ASIN either',
    cleanProductLabel(null) === 'Untitled link')
  check('a normal title is left alone',
    cleanProductLabel('Gracyoga Men’s Polo Shirts Casual Knit Texture Collared Golf Shirt')
      === 'Gracyoga Men’s Polo Shirts Casual Knit Texture Collared Golf Shirt')
}

// ── "COUNTRIES REACHED: 🌐 RU · 🌐 PY · 🌐 SX" ──────────────────────────────
// Derived from the code rather than a lookup table, so a country nobody
// anticipated still gets a flag and a name instead of a grey globe.
{
  check('US resolves', countryName('US') === 'United States')
  check('the ones that showed a globe now resolve',
    countryName('RU') === 'Russia' && countryName('PY') === 'Paraguay' && countryName('SX') === 'Sint Maarten',
    `${countryName('RU')} / ${countryName('PY')} / ${countryName('SX')}`)
  check('lowercase input still works', countryName('de') === 'Germany')
  check('junk does not crash', countryName('') === 'Unknown' && countryName('XYZ') === 'XYZ')

  check('every alpha-2 code gets a flag', countryFlag('SX') === '🇸🇽' && countryFlag('PY') === '🇵🇾')
  check('lowercase gets a flag too', countryFlag('de') === '🇩🇪')
  check('junk falls back to a globe rather than mojibake', countryFlag('') === '🌐' && countryFlag('XYZ') === '🌐')
}

// ── "DEVICES & BROWSERS: Unknown 329" ───────────────────────────────────────
// The real failure: "Unknown" sat in the same list as Chrome and Safari, as if
// it were a browser somebody used. It is the share of the data that is missing.
{
  const rows = [
    { browser: 'Chrome' }, { browser: 'Chrome' }, { browser: 'Safari' },
    { browser: null }, { browser: null }, { browser: null }, { browser: null },
    { browser: 'Bot' },
  ]
  const c = coverage(rows)
  check('known counts only real browsers', c.known === 3, JSON.stringify(c))
  check('bots are neither known nor unclassified', c.unclassified === 4, JSON.stringify(c))

  const note = coverageNote(c) || ''
  check('the note states the real coverage', /3 of 7 clicks/.test(note), note)
  check('and gives the share as a percentage', /43%/.test(note), note)
  check('and says plainly that the rest are excluded', /not counted in this panel/.test(note), note)

  check('a clean account is not nagged', coverageNote({ known: 10, unclassified: 0 }) === null)
  check('and neither is an empty one', coverageNote({ known: 0, unclassified: 0 }) === null)
  check('but a fully unreadable account IS told',
    (coverageNote({ known: 0, unclassified: 5 }) || '').includes('0 of 5'),
    'this is the state that made the old dashboard look precise while knowing nothing')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
