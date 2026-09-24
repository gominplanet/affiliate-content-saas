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
const inOrderRaw = (src: string, a: string, b: string) => { const i = src.indexOf(a), j = src.indexOf(b); return i > -1 && j > -1 && i < j }

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
    /const giveUp = \(detail\) => \{[\s\S]{0,160}?out\.skipped = true/.test(kitTag) && /return giveUp\('YouTube Shopping has no listing for this product/.test(kitTag))
  const kitEnd = BG.slice(BG.indexOf('K.steps.endscreen = '), BG.indexOf('K.steps.checks = '))
  check('the end-screen picker is searched in every popup that opened',
    /const pops = dialogsNow\(\)\.filter\(\(x\) => !before\.includes\(x\)\)/.test(kitEnd) && /tagCards\(\)/.test(kitEnd))
}

// ── second real Co-Pilot run, 1.21.3 ─────────────────────────────────────
{
  const kitMon = BG.slice(BG.indexOf('K.steps.monetization = '), BG.indexOf('K.steps.adsuit = '))
  check('the monetization switch is a visible one, not a hidden copy on another page',
    /el\.id === 'child-input' && visible\(el\)/.test(kitMon) && !/const byChild = byId\('child-input', dlg\)/.test(kitMon))
  const kitEnd = BG.slice(BG.indexOf('K.steps.endscreen = '), BG.indexOf('K.steps.checks = '))
  check('the end screen goes through the editor\'s Import from latest video, and only reports a Save that happened',
    /\/\^import from latest video\$\/i/.test(kitEnd) && /save = await waitFor\(editorSave, 6000, 400\)/.test(kitEnd) && /if \(!save\) \{/.test(kitEnd))
  const kitTag = BG.slice(BG.indexOf('K.steps.tagproduct = '), BG.indexOf('K.steps.endscreen = '))
  check('a product found by name is only tagged when its model number matches',
    /const models = want\.filter\(\(w\) => \/\\d\/\.test\(w\) && \/\[a-z\]\/\.test\(w\) && w\.length >= 3\)/.test(kitTag)
    && /if \(models\.some\(\(m\) => !have\.has\(m\)\)\) return false/.test(kitTag)
    && /if \(viaName && !sameProduct\(viaName, name\)\)/.test(kitTag))
  check('the Amazon product page is tried first', /const links = \[o\.amazonUrl, o\.productUrl\]/.test(kitTag)
    && /amazonUrl: productLinkFor\(effectiveAsin\)/.test(readFileSync(join(root, 'app/(dashboard)/co-pilot/page.tsx'), 'utf8')))
}

// ── third real run, 1.21.4: the creator's own route to a product tag ─────
{
  const kitTag = BG.slice(BG.indexOf('K.steps.tagproduct = '), BG.indexOf('K.steps.endscreen = '))
  check('the empty search bar is clicked first, and YouTube\'s own suggestion followed',
    /try \{ input\.focus\(\); click\(input\) \} catch/.test(kitTag) && /const sugg0 = await waitFor\(suggestion, 5000, 300\)/.test(kitTag)
    && kitTag.indexOf('const sugg0') < kitTag.indexOf('const links = [o.amazonUrl, o.productUrl]'))
  check('the Recently tagged list is never taken for results', /if \(recentShown\(\)\) return \[\]/.test(kitTag))
  check('the + is found as an icon button with no text, rightmost in its row',
    /lbl === '' \|\| lbl === '\+'/.test(kitTag) && /else if \(r\.left > row\.b\.getBoundingClientRect\(\)\.left\) row\.b = b/.test(kitTag))
  check('then Next, then Done on the timestamps page', inOrderRaw(kitTag, 'click(pick)', "findBtn(/^next$/i, d, { enabled: true })") && /findBtn\(\/\^done\$\/i, document, \{ enabled: true \}\)/.test(kitTag))
}

// ── 1.21.5: monetization the way the creator does it ─────────────────────
{
  const kitMon = BG.slice(BG.indexOf('K.steps.monetization = '), BG.indexOf('K.steps.adsuit = '))
  check('after On, Next is pressed (On turns Done into Next)', /findBtn\(\/\^\(next\|done\|save\)\$\/i, scopeNow\(\), \{ enabled: true \}\)/.test(kitMon))
  const rate = BG.slice(BG.indexOf('K.rate = async'), BG.indexOf('K.steps.monetization = '))
  check('the rating ticks None of the above, then Submits only once it lights up, and counts only a window that closed',
    /none of the above/i.test(rate) && /if \(!isChecked\(box\)\) \{ click\(box\)/.test(rate)
    && /findBtn\(\/\^submit\( rating\)\?\$\/i, document, \{ enabled: true \}\)/.test(rate) && /return 'submitted'/.test(rate)
    && rate.indexOf("waitFor(() => (open() ? null : true)") > -1 && rate.indexOf("waitFor(() => (open() ? null : true)") < rate.indexOf("return 'submitted'"))
  check('not asked for, the rating is cancelled, never submitted', /if \(!o\.selfCert\) \{\s*const cancel = findBtn\(\/\^cancel\$\/i, document\)/.test(rate))
  check('the rating done with monetization is the Ad suitability row',
    /const mo = await exec\('monetization', \{ on: !!want\.monetize, selfCert: !!want\.selfCert \}\)/.test(BG) && /done\.add\('adsuit'\)/.test(BG))
  const vid = BG.slice(BG.indexOf('function studioFinishMonetizeInPage('), BG.indexOf('function studioFinishEndScreenInPage('))
  check('the video page does the same: Next, None of the above, a lit Submit, then its own Save',
    /const nextBtn = await waitFind\(\[\/\^next\$\/i\], 4000\)/.test(vid) && /if \(enabled\(b\)\) \{ submit = b; break \}/.test(vid) && /out\.certOk = !rateOpen\(\)/.test(vid))
}

// ── 1.21.6: a greyed button is greyed on its wrapper too ──────────────────
{
  const kit = BG.slice(BG.indexOf('function studioKitInstallInPage()'), BG.indexOf('K.steps = {}'))
  check('disabled is read on the button\'s wrapper as well as the button',
    /const isDisabled = \(el\) => \{[\s\S]{0,400}?for \(let i = 0; i < 4 && e; i\+\+\)/.test(kit))
  check('the kit version moves when the kit changes', /const KIT_VERSION = 5\b/.test(BG))
  const kitMon = BG.slice(BG.indexOf('K.steps.monetization = '), BG.indexOf('K.steps.adsuit = '))
  check('a menu that opened is not clicked shut by the next try',
    /if \(dialogsNow\(\)\.some\(\(x\) => !before\.includes\(x\)\)\) \{ onOpt = await waitFor/.test(kitMon))
  const kitEnd = BG.slice(BG.indexOf('K.steps.endscreen = '), BG.indexOf('K.steps.checks = '))
  check('an end-screen editor that stayed open after Save is a failure, said as such',
    /it stayed open, so the end screen was not saved/.test(kitEnd))
}

// ── 1.21.7: a page still loading is not an unknown page ──────────────────
{
  const where = BG.slice(BG.indexOf('K.steps.where = '), BG.indexOf('K.steps.next = '))
  check('where waits for the page to settle before calling it unknown',
    /const known = await waitFor\(\(\) => \{ const d = mainDialog\(\); if \(!d\) return null; const p = page\(d\); return p !== 'unknown' \? p : null \}, 15000, 500\)/.test(where))
  check('Co-Pilot names the step the run actually stopped at, the last failure',
    /const stoppedAt = failedSteps\[failedSteps\.length - 1\]/.test(readFileSync(join(root, 'app/(dashboard)/co-pilot/page.tsx'), 'utf8')))
}

// ── 1.21.8: every suggestion, the specific ones first ─────────────────────
{
  const kitTag = BG.slice(BG.indexOf('K.steps.tagproduct = '), BG.indexOf('K.steps.endscreen = '))
  check('every YouTube suggestion is tried, the ones with a model number first',
    /\.sort\(\(x, y\) => \(hasModel\(y\) \? 1 : 0\) - \(hasModel\(x\) \? 1 : 0\)\)/.test(kitTag) && /for \(const t of suggTexts\)/.test(kitTag)
    && /if \(sameProduct\(t, top\)\) \{ viaName = t; found = true; break \}/.test(kitTag))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
