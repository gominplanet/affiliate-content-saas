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

// The toolkit both Studio routes use (a draft's Edit draft window, and a
// video's own Details page), so a match elsewhere in a 9,000-line file cannot
// pass this.
const at = BG.indexOf('function studioKitInstallInPage')
check('the Studio toolkit is findable', at > 0)
const fn = BG.slice(at, at + 60000)

check('there is a radio helper distinct from the checkbox one',
  /const pickRadio = \(section, choiceRe, scope\)/.test(fn) && /const pickCheckbox = \(section, scope\)/.test(fn))
check('and it only clicks a radio that is not already the wanted answer',
  /if \(!isChecked\(el\)\) \{ click\(el\); did = 'set'/.test(fn),
  'toggling a radio pair is how the No answer got selected')
check('it matches the radio\'s own text AND its nearest section',
  /choiceRe\.test\(t\)/.test(fn) && /sectionOf\(el\) !== section/.test(fn),
  'both radios say "paid promotion", so the section alone cannot tell them apart')
check('a checkbox is matched by its own label, not its section',
  /SECTIONS\[section\]\.test\(labelOf\(el\)\)/.test(fn),
  'allow embedding and notify subscribers share a block; by section they were interchangeable')

check('paid promotion asks for Yes through the radio helper',
  /answerRadio\('paid', \/\^yes/.test(fn))
check('with the old checkbox kept only as a fallback',
  /if \(!r\.found\) (r = )?await answerCheckbox\('paid', true/.test(fn),
  'some accounts may still be served the previous layout')
check('AI use goes through the same helper',
  /answerRadio\('altered', \/\^no/.test(fn),
  'its radios are a bare Yes and No, so nothing but the section identifies them')
check('a video that is not a draft is saved, reloaded and read back',
  /K\.steps\.readDetails/.test(fn) && /studioDraftExec\(tabId, 'readDetails', ask\)/.test(BG),
  'a Save that went grey is Studio saying it saved, not proof it kept the answers')

// The headline must not claim a clean run off one lucky step.
const orch = BG.slice(BG.indexOf('const asked = steps.filter'), BG.indexOf('const asked = steps.filter') + 400)
check('a run is only ok when every asked-for step is ok',
  /good\.length === asked\.length/.test(orch),
  'steps.some() reported success when details failed and end screens happened to work')
check('and a partial run says so',
  /partial: good\.length > 0 && good\.length < asked\.length/.test(orch))
check('success requires every answer to read back, not merely be found',
  /rb\.paidPromotion === true/.test(fn) && /out\.ok = failed\.length === 0/.test(fn),
  '"not-found" was the only thing that counted as failure, so any other outcome passed')

// A fix nobody can install is not a fix.
const manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))
check('the manifest and the app registry agree on the version',
  manifest.version === SCOUT_LATEST_VERSION,
  `manifest ${manifest.version}, registry ${SCOUT_LATEST_VERSION}`)

// ── audit, 1.21.1 ─────────────────────────────────────────────────────────
{
  const mon = BG.slice(BG.indexOf('function studioFinishMonetizeInPage(opts) {'), BG.indexOf('function studioFinishEndScreenInPage() {'))
  check('monetization is only switched On when it was asked for', /const wantOn = o\.monetize !== false/.test(mon) && /const trigger = wantOn \?/.test(mon))
  check('and the Video page run passes both answers', /\[\{ monetize: want\.monetize === true, selfCert: want\.selfCert === true \}\]/.test(BG))
  check('the read-back only looks at what is on screen', /const shown = \(el\) =>/.test(mon) && /!shown\(el\)/.test(mon))
  check('a rating asked for and not sent is not a green tick', /out\.ok = monOn && \(!o\.selfCert \|\| out\.certOk\)/.test(mon))
  check('the checks page does not stop on its own age-restriction help text',
    /return \/claim\|issues\? found\|violation\|blocked\/\.test\(rest\)/.test(BG) && !/violation\|restrict\|blocked/.test(BG))
  check('a missing notify box only fails when Yes was asked',
    /if \(rb\.notifySubscribers === null && o\.notify !== true\)/.test(BG) && /else if \(o\.notify !== true\) checks\.push/.test(BG))
  check('Amazon tab that never opened rejects instead of hanging', /if \(chrome\.runtime\.lastError \|\| !tab \|\| tab\.id == null\)/.test(BG))
}

// ── first real Co-Pilot run, 1.21.2 ───────────────────────────────────────
{
  const kitMon = BG.slice(BG.indexOf('K.steps.monetization = '), BG.indexOf('K.steps.adsuit = '))
  check('the On choice is found even with help text after it, or by its id',
    /isRadio\(el\) && visible\(el\) && \/\^on\\b\/i\.test\(ctrlText\(el\)\)/.test(kitMon) && /byId\('radio-on', sc\)/.test(kitMon))
  check('and the menu is opened through the label\'s button if the label opens nothing',
    /for \(const opener of openers\)/.test(kitMon))
  const kitVis = BG.slice(BG.indexOf('K.steps.visibility = '), BG.indexOf('window.__mvpKit = K'))
  check('the scheduled date is read once Studio has caught up, not after a fixed pause',
    /let matched = await waitFor\(dateMatches, 6000, 300\)/.test(kitVis) && !/await sleep\(1200\)\n\s*const shownDate/.test(kitVis))
  const kitTag = BG.slice(BG.indexOf('K.steps.tagproduct = '), BG.indexOf('K.steps.endscreen = '))
  check('a product YouTube Shopping does not list is not a red cross',
    /out\.skipped = true\n\s*out\.detail = 'YouTube Shopping has no listing for this product/.test(kitTag))
  const kitEnd = BG.slice(BG.indexOf('K.steps.endscreen = '), BG.indexOf('K.steps.checks = '))
  check('the end-screen picker is searched in every popup that opened',
    /const pops = dialogsNow\(\)\.filter\(\(x\) => !before\.includes\(x\)\)/.test(kitEnd) && /tagCards\(\)/.test(kitEnd))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
