// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A SILENT FALLBACK IS INDISTINGUISHABLE FROM BEING IGNORED.
//
// A creator reported: "generation still ignores the link-style setting entirely
// — a brand-new post is flagged 'Wrong style' by your own fixer."
//
// It did not ignore the setting. getLinkStyle read it, the Geniuslink branch
// ran, Geniuslink answered 401 because his stored keys are not usable, and this
// catch swallowed it:
//
//   } catch {
//     // Geniuslink threw (e.g. rejected/401 API keys). Fall back to the
//     // TAGGED product link so the user's Associates commission still applies.
//     affiliateUrlOverride = tagFallback
//   }
//
// The post published with a plain Amazon link and nothing anywhere said why.
// From his side "MVP ignored my setting" and "MVP tried and failed" produce the
// identical screen, and only one of them is something he can fix in a minute.
//
// The sentence to say already existed. lib/link-cloak's cloakFallbackNote
// writes one per cause, including "your API key and secret are not working,
// re-enter them under External Integrations". It was wired into the deal path
// and never into the blog path, which is where almost every link is made.
//
// So: every fallback in that chain names itself, and it reaches the screen.
// Checked on the source, because what broke was an empty catch block and no
// pure function can see one of those.
import { readFileSync } from 'node:fs'
import { cloakFallbackNote } from '../lib/link-cloak'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const strip = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const ROUTE = readFileSync('app/api/blog/generate/route.ts', 'utf8')
const route = strip(ROUTE)
const BUTTON = strip(readFileSync('components/content/GenerateButton.tsx', 'utf8'))

// ── the sentences exist and are worth reading ─────────────────────────────
//
// Everything below asserts the note is WIRED UP. If the notes themselves went
// vague, all of that would pass while meaning nothing.
{
  const cases = [
    ['geniuslink-api-failed', /geniuslink/i, 'names the service'],
    ['geniuslink-no-creds', /re-enter/i, 'says what to do'],
    ['style-downgraded', /credentials are missing/i, 'names the cause'],
    ['bitly-no-token', /bitly/i, 'names the service'],
    ['passport-mint-failed', /passport/i, 'names the service'],
  ] as const
  for (const [reason, pattern, why] of cases) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const note = cloakFallbackNote({ cloaked: false, reason, url: 'x' } as any)
    check(`${reason} has a note`, !!note, reason)
    check(`${reason} ${why}`, pattern.test(note ?? ''), note ?? '')
    check(`${reason} says the post still went out`, /plain amazon link/i.test(note ?? ''), note ?? '')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check('a cloaked link says nothing at all', cloakFallbackNote({ cloaked: true, url: 'x' } as any) === null,
    'a note on a link that worked is noise, and noise is what makes the real notes ignorable')
}

// ── the blog route captures a fallback instead of swallowing it ───────────
{
  check('the blog route imports the note writer', /cloakFallbackNote/.test(route),
    'it existed for months and was wired into the deal path only')
  check('and declares somewhere to put it', /let linkFallbackNote: string \| null = null/.test(route))

  // The empty catch is the defect, quoted exactly.
  const geniusCatch = route.match(/\} catch \{[\s\S]{0,400}?affiliateUrlOverride = tagFallback[\s\S]{0,300}?\}/)
  check('the Geniuslink catch is still there to be checked', !!geniusCatch)
  check('and it no longer falls back in silence',
    /linkFallbackNote = cloakFallbackNote/.test(geniusCatch?.[0] ?? ''),
    'this catch is where a 401 on a creator\'s keys disappeared')

  check('a wrong-destination link gets its OWN sentence',
    /short link it created pointed at a different product/.test(route),
    'telling that creator to re-enter credentials sends them to fix something that is not broken')

  check('and a style that could not be used at all is named',
    /blogLinkStyle\.downgradedFrom/.test(route),
    'missing credentials and rejected credentials are different fixes')
}

// ── and it survives to the response ───────────────────────────────────────
//
// The first attempt at this declared the variable inside the block that set it,
// so it compiled in that block and did not exist at the response. A note nobody
// receives is the same as no note.
{
  const decl = route.indexOf('let linkFallbackNote')
  const use = route.lastIndexOf('linkFallbackNote,')
  check('the response carries the note', use !== -1,
    'captured and then dropped is the same outcome as never captured')
  check('and it is declared before the response, in the same function',
    decl !== -1 && decl < use, `decl ${decl}, response ${use}`)
  check('it is declared in the handler, not in the link block',
    /async function handleGenerate\(request: Request\) \{\s*(?:\n\s*)*let linkFallbackNote/.test(
      ROUTE.replace(/^\s*\/\/.*$/gm, '')),
    'declared inside the style chain it dies there, which is how the first version of this failed')
}

// ── and the creator actually sees it ──────────────────────────────────────
{
  check('the generate button reads the note', /data\.linkFallbackNote/.test(BUTTON))
  check('and shows it', /toast\.(warning|error|info)\(data\.linkFallbackNote/.test(BUTTON),
    'a field in a JSON response that nothing renders is a silent fallback with extra steps')
  check('as a warning, not an error', /toast\.warning\(data\.linkFallbackNote/.test(BUTTON),
    'the post is live and earning; it is the link style that did not apply')
  check('and it stays up long enough to read',
    /data\.linkFallbackNote as string, \{ duration: \d{5} \}/.test(BUTTON),
    'it names something to go and fix, so it cannot flash past')
}

// ── house style ───────────────────────────────────────────────────────────
{
  for (const reason of ['geniuslink-api-failed', 'geniuslink-no-creds', 'style-downgraded', 'bitly-failed']) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const note = cloakFallbackNote({ cloaked: false, reason, url: 'x' } as any) ?? ''
    check(`no dash punctuation in the ${reason} note`, !/[—–]|\s-\s/.test(note), note)
    check(`no year in the ${reason} note`, !/\b20\d{2}\b/.test(note), note)
  }
}

if (failures.length) {
  console.error(`\n❌ link-fallback-voice: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ link-fallback-voice: a link style that could not be used says so, all the way to the screen')
