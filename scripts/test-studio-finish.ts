// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The Studio finish must answer YouTube's questions, not toggle them.
//
// Studio replaced the paid-promotion CHECKBOX ("This video contains paid
// promotion like a paid product placement, sponsorship, or endorsement") with a
// RADIO PAIR: "Yes, my video includes paid promotion" and "No, my video doesn't
// include paid promotion". Both contain the words "paid promotion", and the
// code still searched for a checkbox and toggled whatever it matched first.
//
// That is worse than a miss. Landing on the "No" radio, finding it unchecked
// and clicking it does not fail to set the disclosure, it answers a compliance
// question wrongly on the creator's behalf, on their own channel.
//
// So a radio is never toggled. It is located by its OWN text inside the right
// section, and clicked only when it is the wanted answer.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCOUT_LATEST_VERSION } from '../lib/scout-version'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const BG = readFileSync(join(root, 'extension/background.js'), 'utf8')

// Just the details step, so a match elsewhere in a 9,000-line file cannot pass this.
const at = BG.indexOf('function studioFinishDetailsInPage')
check('the details step is findable', at > 0)
const fn = BG.slice(at, at + 12000)

check('there is a radio helper distinct from the checkbox one',
  /const setRadio = \(sectionRe, choiceRe, key\)/.test(fn))
check('and it only clicks a radio that is already the wanted answer',
  /if \(isChecked\(el\)\) \{ out\.actions\[key\] = 'already-set' \} else \{ click\(el\)/.test(fn),
  'toggling a radio pair is how the No answer got selected')
check('it scopes by section AND matches the radio\'s own text',
  /choiceRe\.test\(own\)/.test(fn) && /sectionRe\.test\(ctx\(c, 8\)\)/.test(fn),
  'both radios say "paid promotion", so the section alone cannot tell them apart')

check('paid promotion asks for Yes through the radio helper',
  /setRadio\(\/paid promotion\/i, \/\^yes/.test(fn))
check('with the old checkbox kept only as a fallback',
  /if \(!paidRadio\)/.test(fn),
  'some accounts may still be served the previous layout')
check('and the layout it found is recorded',
  /out\.debug\.paidLayout/.test(fn),
  'when Studio changes again, the debug should say which shape it saw')

check('AI use goes through the same helper',
  /setRadio\(\/ai use\|/.test(fn),
  'its radios are a bare Yes and No, so nothing but the section identifies them')

// The headline must not claim a clean run off one lucky step.
const orch = BG.slice(BG.indexOf('const asked = steps.filter'), BG.indexOf('const asked = steps.filter') + 400)
check('a run is only ok when every asked-for step is ok',
  /good\.length === asked\.length/.test(orch),
  'steps.some() reported success when details failed and end screens happened to work')
check('and a partial run says so',
  /partial: good\.length > 0 && good\.length < asked\.length/.test(orch))
check('success requires paid promotion to be SET, not merely seen',
  /out\.actions\.paidPromotion === 'set'/.test(fn),
  '"not-found" was the only thing that counted as failure, so any other outcome passed')

// A fix nobody can install is not a fix.
const manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))
check('the manifest and the app registry agree on the version',
  manifest.version === SCOUT_LATEST_VERSION,
  `manifest ${manifest.version}, registry ${SCOUT_LATEST_VERSION}`)

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
