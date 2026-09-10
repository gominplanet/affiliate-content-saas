// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Browse's search box has to find things while you are still typing.
//
// It searched with websearch_to_tsquery, which matches whole words only, so on
// a 918,748-row catalogue "humidifier" returned thousands of campaigns and
// "humid" returned none. The search reloads on a 300ms debounce as you type, so
// every keystroke on the way to a complete word rendered an empty page and the
// box read as broken rather than as still loading.
//
// These pin the query shapes. The tsquery text is checked directly because a
// malformed one does not return the wrong rows, it throws, and the route's
// fallback ladder would silently drop back to whole-word search: the search
// would look like it worked while being exactly as bad as before.
import {
  ccAsinFromQuery, ccTsQuery, ccSearchMode, ccPageSize,
  CC_BROWSE_PAGE_DEFAULT, CC_BROWSE_PAGE_MAX,
} from '../lib/cc-search-query'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the case this exists for ────────────────────────────────────────────────
{
  check('a partial word becomes a prefix', ccTsQuery('humid') === 'humid:*',
    String(ccTsQuery('humid')))
  // humidifier stems to humidifi, which starts with humid, so the prefix
  // matches. That is the whole mechanism.
  check('a complete word is still a prefix', ccTsQuery('humidifier') === 'humidifi:*'
    || ccTsQuery('humidifier') === 'humidifier:*', String(ccTsQuery('humidifier')))

  // Earlier words are finished, so they stay exact. Only the word under the
  // cursor is a prefix.
  check('only the last token is a prefix', ccTsQuery('cool mist humid') === 'cool & mist & humid:*',
    String(ccTsQuery('cool mist humid')))
}

// ── tsquery safety ──────────────────────────────────────────────────────────
{
  // & | ! : * and parentheses are tsquery OPERATORS. A product name full of
  // them must arrive as words, never as syntax, or to_tsquery throws.
  const nasty = ccTsQuery("Anker's 65W & 100W | charger !new (2-pack)")
  check('operators never survive into the query', !/[&|!():]/.test((nasty ?? '').replace(/ & /g, ' ').replace(/:\*$/, '')),
    String(nasty))
  check('the sanitised query still has terms', (nasty ?? '').includes('anker'), String(nasty))

  // A query that is only punctuation has nothing to search for. null means "no
  // keyword filter", which browses everything, rather than an empty tsquery
  // that would match nothing and read as a broken catalogue.
  check('punctuation only is null', ccTsQuery('!!! &&& ((( ') === null, String(ccTsQuery('!!! &&&')))
  check('empty is null', ccTsQuery('') === null && ccTsQuery(null) === null && ccTsQuery(undefined) === null)
  check('whitespace only is null', ccTsQuery('   ') === null)

  // Accented brand names are words, not separators.
  check('accents survive as letters', ccTsQuery('Bébé') === 'bébé:*', String(ccTsQuery('Bébé')))

  // A paste is bounded so the GIN index is never handed an essay.
  const long = ccTsQuery('one two three four five six seven eight nine ten')
  check('a long paste is capped at six tokens', (long ?? '').split(' & ').length === 6, String(long))
  check('the cap still leaves the last token a prefix', (long ?? '').endsWith(':*'), String(long))
}

// ── pasted ASINs ────────────────────────────────────────────────────────────
{
  check('a pasted ASIN is recognised', ccAsinFromQuery('B0FHK9DYTC') === 'B0FHK9DYTC')
  check('a lowercase ASIN is uppercased', ccAsinFromQuery('b0fhk9dytc') === 'B0FHK9DYTC')
  check('surrounding whitespace is tolerated', ccAsinFromQuery('  B0FHK9DYTC \n') === 'B0FHK9DYTC')

  // "humidifier" is ten characters. Requiring the B0 prefix is what stops a
  // ten-letter product word from being routed down the ASIN path and returning
  // nothing.
  check('a ten-letter word is not an ASIN', ccAsinFromQuery('humidifier') === null)
  check('a partial ASIN is not an ASIN', ccAsinFromQuery('B0FHK9DY') === null)
  check('an ASIN inside a sentence is not an ASIN', ccAsinFromQuery('buy B0FHK9DYTC now') === null,
    'that is a keyword search, and full text handles it')
}

// ── routing ─────────────────────────────────────────────────────────────────
{
  check('nothing typed browses everything', ccSearchMode('') === 'none' && ccSearchMode('  ') === 'none')
  check('an ASIN routes to the asins index', ccSearchMode('B0FHK9DYTC') === 'asin')
  check('a word routes to prefix search', ccSearchMode('humid') === 'prefix')
  check('punctuation only browses everything', ccSearchMode('###') === 'none',
    'not "prefix" with a null query, which would filter on nothing')
}

// ── page size ───────────────────────────────────────────────────────────────
{
  check('the default is 100', ccPageSize(undefined) === CC_BROWSE_PAGE_DEFAULT && CC_BROWSE_PAGE_DEFAULT === 100)
  check('a caller can ask for fewer', ccPageSize('25') === 25)
  check('a caller cannot ask for the whole table', ccPageSize('100000') === CC_BROWSE_PAGE_MAX)
  check('garbage falls back to the default', ccPageSize('abc') === CC_BROWSE_PAGE_DEFAULT && ccPageSize(null) === CC_BROWSE_PAGE_DEFAULT)
  check('zero and negatives fall back', ccPageSize(0) === CC_BROWSE_PAGE_DEFAULT && ccPageSize(-5) === CC_BROWSE_PAGE_DEFAULT)
  check('a fraction is floored to an integer', Number.isInteger(ccPageSize('12.9')) && ccPageSize('12.9') === 12)
}

if (failures.length) {
  console.error(`\n❌ cc-search-query: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ cc-search-query: partial words match, operators cannot reach to_tsquery, ASINs route to their own index')
