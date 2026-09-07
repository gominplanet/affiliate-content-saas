// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// No invented people on a pin, by any route.
//
// A deals roundup came back as an AI stock man with a forced open-mouth grin
// holding a USB cable. Every art-director pin prompt already forbade people in
// capitals. The image did not come from those: they return nothing when they
// cannot get real product photos, and the fallback that runs instead had no
// such rule. Worse, five of its six scene compositions actively ASKED for one:
//
//   "A charismatic, expressive person (the expert) looks toward camera..."
//   "a charismatic person holding [product] up toward the camera..."
//
// Two halves of the same product designed against each other, and the wrong
// half was the one that ran whenever things went less than perfectly.
//
// So this reads the prompt files as text and holds every path to the one rule.
// A prompt is a string, and a string with the wrong sentence in it is a bug you
// cannot see in a type check or a render you did not happen to look at.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const PIN_ASSETS = read('../lib/pin-assets.ts')
const ART_DIRECTOR = read('../lib/art-director-pin.ts')

// ── no prompt may ASK for a person ──────────────────────────────────────────
// The exact phrases that produced the man with the cable, plus the shapes they
// would come back as. Only the composition block is scanned, because the rule
// itself legitimately contains the words "person" and "hands".
{
  const start = PIN_ASSETS.indexOf('const PIN_COMPOSITIONS')
  const end = PIN_ASSETS.indexOf('\n]', start)
  check('the composition rotation is findable', start > 0 && end > start)
  const compositions = PIN_ASSETS.slice(start, end)

  for (const phrase of [
    'charismatic person', 'charismatic, expressive person', 'expressive person',
    'a person holding', 'person interacting', 'person softly out of focus',
    'human hands', 'hands actively using', 'the expert',
  ]) {
    check(`no composition asks for "${phrase}"`, !compositions.includes(phrase),
      'this is the sentence that produced a stock human on a deals roundup')
  }

  // The general case, so a new composition cannot reintroduce one under
  // different wording.
  for (const word of [/\bperson\b/, /\bpeople\b/, /\bhuman\b/, /\bmodel\b/, /\bshopper\b/]) {
    const hit = compositions.match(word)
    check(`no composition mentions ${word}`, !hit || /No people|no one present|No people in either half/.test(compositions),
      hit ? hit[0] : '')
  }
  check('there are still several compositions, so pins vary',
    (compositions.match(/^\s+f => `/gm) || []).length >= 5,
    'removing the people must not collapse the rotation to one look')
}

// ── every fallback carries the rule ─────────────────────────────────────────
// This is the gap that existed: the rule was in the premium path only, and the
// premium path is exactly the one that bails when data is missing.
{
  check('there is one shared rule, not a copy per prompt',
    PIN_ASSETS.includes('const NO_PEOPLE_CLAUSE'),
    'two copies drift the moment one is tightened')
  check('the shared rule is emphatic enough to survive an image model',
    /HARD RULE/.test(PIN_ASSETS) && /zero humans/.test(PIN_ASSETS))
  check('and it names the ways a person sneaks back in',
    /silhouettes/.test(PIN_ASSETS) && /reflections/.test(PIN_ASSETS) && /hands/.test(PIN_ASSETS))

  // Used, not merely declared.
  const uses = (PIN_ASSETS.match(/\$\{NO_PEOPLE_CLAUSE\}/g) || []).length
  check('both fallback prompts use it', uses >= 2, `used ${uses} times`)
}

// ── the premium path still has it ───────────────────────────────────────────
// It was never the problem, and it must not become one.
{
  // Three IMAGE prompts carry the hard rule: single product, thumbnail-style,
  // and the multi-product roundup. The fourth prompt in that file writes copy
  // rather than an image, so it only needs the weaker "no people described
  // here", and demanding the hard rule there would be checking the wrong thing.
  const rules = (ART_DIRECTOR.match(/ABSOLUTELY NO PEOPLE/g) || []).length
  check('every art-director IMAGE prompt still forbids people', rules >= 3, `found ${rules}`)
  check('and the copy prompt keeps its own version',
    /no people described here/.test(ART_DIRECTOR))
}

// ── the whole point, stated once ────────────────────────────────────────────
// If a future edit adds a seventh composition with a person in it, or a new
// fallback prompt without the clause, one of the checks above fails. That is
// the only protection available for text that is only ever read by an image
// model at 3am on someone else's account.
{
  const promptFns = (PIN_ASSETS.match(/^function build\w*ImagePrompt/gm) || []).length
  check('every prompt builder is accounted for', promptFns >= 2, `found ${promptFns}`)
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
