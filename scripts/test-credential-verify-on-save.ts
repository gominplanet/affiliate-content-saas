// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "SAVED" IS NOT AN ANSWER TO "DOES MY KEY WORK?"
//
// A creator's posts were publishing plain Amazon links. The cause was his
// Geniuslink credentials being rejected, and the advice he was given was to
// re-enter them.
//
// Follow that advice through. He opens the form, pastes the key, presses Save,
// and the screen says the settings were saved. Which is true, and tells him
// nothing about the only question he has. He then writes an article, waits for
// it to publish, opens it, and checks a link. That is the round trip to learn
// whether a paste worked.
//
// And if it did not work, he has no way to tell that apart from the original
// problem, so the next message is the same message.
//
// /api/geniuslink/test already asks Geniuslink directly. The save path never
// asked. So it does now, on the values just written, and reports one of three
// things rather than one:
//
//   verified true    Geniuslink accepted it, and how many groups it saw
//   verified false   saved, and Geniuslink refused it, so links stay plain
//   verified null    no new credentials were supplied, so nothing was checked
//
// That third state is the one to defend. Verifying on every save of this form
// would put a network call on a Pinterest preference change and report a
// Geniuslink outage as a failure to save something unrelated.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const strip = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

const SAVE_RAW = readFileSync('app/api/affiliate-links/save/route.ts', 'utf8')
const SAVE = strip(SAVE_RAW)
const BRAND = strip(readFileSync('app/(dashboard)/brand/page.tsx', 'utf8'))

// ── the save asks Geniuslink, rather than only storing ────────────────────
{
  check('the save path can reach Geniuslink', /createGeniuslinkService/.test(SAVE),
    'without this "Saved" is the only thing it can ever say')
  check('and it asks the same question the test button asks', /\.listGroups\(\)/.test(SAVE),
    'a different check would drift from the one the creator sees on the test button')
  check('the verdict is recorded', /let geniuslinkVerified: boolean \| null = null/.test(SAVE))
}

// ── the three states are kept apart ───────────────────────────────────────
{
  check('it only checks when NEW credentials were supplied',
    /if \(suppliedKey && suppliedSecret\)/.test(SAVE),
    'checking on every save puts a network call on a Pinterest preference and reports an outage as a save failure')
  check('so an unrelated save leaves the verdict unknown',
    /geniuslinkVerified: boolean \| null = null/.test(SAVE),
    'null is "not checked", which must not render as "works"')

  check('a rejection is recorded as false, not as a failed save',
    /geniuslinkVerified = false/.test(SAVE))
  check('and the key is still written',
    /Saved, but Geniuslink rejected these credentials/.test(SAVE_RAW),
    'refusing the write would strand somebody whose key is right during a Geniuslink outage')
  check('and the consequence is named', /publishing as plain Amazon links/.test(SAVE_RAW),
    'a creator needs to know what the rejection costs them, not just that it happened')
  check('with Geniuslink\'s own reason carried through',
    /e instanceof Error \? e\.message/.test(SAVE),
    'our paraphrase of a 401 is worth less than what Geniuslink actually said')

  check('a success says how many groups it saw', /link group\$\{groups\.length === 1/.test(SAVE_RAW),
    'a number is proof it really talked to the account; "OK" is not')
}

// ── and it reaches the screen, ahead of everything else ───────────────────
{
  check('the brand page reads the verdict', /data\.geniuslinkVerified/.test(BRAND))
  // Pinned on the MESSAGE reaching the screen, not on the function that puts it
  // there. This used to require setWpPushNote(data.geniuslinkMessage) by name,
  // and that single shared note is exactly what had to go: it was written by
  // three unrelated steps under one hardcoded "the WordPress push failed"
  // headline, so a creator's Geniuslink SUCCESS was shown to him as a WordPress
  // failure (17 Sep). A guard that fails when a bug is fixed teaches whoever
  // hits it to edit the guard rather than read it.
  check('and shows the message', /data\.geniuslinkMessage\)/.test(BRAND),
    'a field nothing renders is the silence this replaces')
  check('and the message is not filed under somebody else\'s headline',
    !/setWpPushNote\(/.test(BRAND),
    'one slot shared by three steps cannot carry a headline for any of them')

  const rejected = BRAND.indexOf('data.geniuslinkVerified === false')
  const accepted = BRAND.indexOf('data.geniuslinkVerified === true')
  const showcase = BRAND.indexOf('data.showcaseWarning')
  check('both outcomes are handled', rejected !== -1 && accepted !== -1)
  check('and a rejection is shown ahead of the other notes',
    rejected !== -1 && showcase !== -1 && rejected < showcase,
    'this is the one the creator is standing there waiting for')

  // Explicit === false, not falsy. `null` means not checked, and a falsy test
  // would report "Geniuslink rejected your key" to somebody who changed a
  // Pinterest setting.
  check('null is not treated as a rejection',
    /geniuslinkVerified === false/.test(BRAND) && !/!data\.geniuslinkVerified/.test(BRAND),
    'a falsy check turns "not checked" into an accusation')
}

// ── house style on what the creator reads ─────────────────────────────────
{
  const sentences = (SAVE_RAW.match(/geniuslinkMessage = [`'][^`']+[`']/g) ?? [])
  check('the messages are there to check', sentences.length >= 2, String(sentences.length))
  for (const s of sentences) {
    check(`no dash punctuation in ${s.slice(22, 58)}`, !/[—–]|\s-\s/.test(s))
    check(`no year in ${s.slice(22, 58)}`, !/\b20\d{2}\b/.test(s))
  }
}

if (failures.length) {
  console.error(`\n❌ credential-verify-on-save: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ credential-verify-on-save: saving a key says whether it works, and "not checked" is its own answer')
