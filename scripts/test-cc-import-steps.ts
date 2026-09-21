// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE INSTRUCTION MUST NAME A BUTTON THAT IS ON THE SCREEN.
//
// The catalogue upload finished and said, in green: Now click "Merge into live
// catalog" below. No button had that name. The button said "Add to live
// catalog", because its label changes with the add-only tick and the sentence
// pointing at it was written once and never moved.
//
// That is this codebase's oldest recurring failure wearing another hat: the one
// instruction between somebody and the thing they wanted, pointing at empty
// space. It happens whenever two pieces of code decide the same thing
// separately, so this pins them to one.
//
// The second half was worse in a quieter way. Four buttons on the page, two of
// them doing the same job, and nothing saying which was next. That is not a
// memory problem, it is a screen that never finished being designed.
import { readFileSync } from 'node:fs'
import { nextStep, mergeLabel, backgroundLabel, type ImportState } from '../lib/cc-import-steps'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const PAGE = read('app/(dashboard)/admin/cc-import/page.tsx')
const PAGE_LIVE = live(PAGE)
const UP = read('components/admin/CcCatalogUploader.tsx')
const UP_LIVE = live(UP)

const base: ImportState = {
  filesPicked: 0, uploaded: false, stagingEmpty: null,
  merging: false, draining: false, merged: false, addOnly: true,
}

// ── one label, read by everything that says it ──────────────────────────────
{
  // NOBODY HARDCODES IT. This is the whole bug: a second copy of the label that
  // did not move when the first one did.
  for (const [where, src] of [['the page', PAGE_LIVE], ['the uploader', UP_LIVE]] as const) {
    check(`${where} does not hardcode the merge label`,
      !/'Add to live catalog'|'Merge into live catalog'/.test(src)
      && !/&ldquo;Merge into live catalog&rdquo;/.test(src),
      'a second copy of the label is exactly what pointed at a button that was not there')
  }
  check('the button is labelled from the shared function',
    /\{mergeLabel\(addOnly\)\}/.test(PAGE_LIVE),
    'a button that names itself is one half of the pair that drifted')
  check('and the sentence pointing at it uses the same function',
    /mergeLabel\(addOnly\)/.test(UP_LIVE),
    'the sentence and the button must come from one string or they will differ again')
  check('the uploader is TOLD the tick rather than assuming it',
    /addOnly\?: boolean/.test(UP) && /addOnly=\{addOnly\}/.test(PAGE),
    'a component guessing the tick will guess wrong the moment somebody unticks it')
  check('the background button shares its label too',
    /\{backgroundLabel\(addOnly\)\}/.test(PAGE_LIVE))

  // THE TWO LABELS DIFFER BY THE TICK, which is why nothing may hardcode one.
  check('the label really does change with the tick',
    mergeLabel(true) !== mergeLabel(false) && backgroundLabel(true) !== backgroundLabel(false),
    'if they were the same string none of this would have happened')
}

// ── the next step is one step, and it names its own button ──────────────────
{
  const staged: ImportState = { ...base, stagingEmpty: false }

  check('a staged upload points at the merge button',
    nextStep(staged).button === mergeLabel(true),
    `${nextStep(staged).button}`)
  check('and the button it names is the one on screen',
    nextStep({ ...staged, addOnly: false }).button === mergeLabel(false),
    'naming the add-only label while the tick is off is the original bug with the sides swapped')

  // ONE RECOMMENDATION. An answer that lists both buttons is the same problem
  // with more words.
  const d = nextStep(staged).detail
  check('the alternative is explained, not offered as an equal',
    d.includes(backgroundLabel(true)) && /rather walk away|instead/.test(d),
    'two buttons of equal weight is what made this a memory test')

  check('files picked but not sent point at the upload button',
    nextStep({ ...base, filesPicked: 3 }).button === 'Upload to staging')
  check('empty staging asks for files and offers nothing to press',
    nextStep({ ...base, stagingEmpty: true }).button === null
    && /Drop/.test(nextStep({ ...base, stagingEmpty: true }).title))

  // A COUNT THAT TIMED OUT IS NOT AN EMPTY STAGING. That count times out on a
  // large table, and reading null as empty would tell somebody to upload again
  // over a staging that is already full.
  const unknown = nextStep({ ...base, stagingEmpty: null })
  check('an unknown staged count is not reported as empty',
    !/Drop/.test(unknown.title) && unknown.waiting,
    'null means we could not tell, which is not the same as nothing there')

  // WHILE IT RUNS THERE IS NOTHING TO PRESS, and saying so is the point: the
  // old screen kept telling somebody to click a button that was already going.
  for (const [what, st] of [
    ['a merge in this tab', { ...staged, merging: true }],
    ['a merge on the server', { ...staged, draining: true }],
  ] as const) {
    const n = nextStep(st as ImportState)
    check(`${what} leaves nothing to press`, n.button === null && n.waiting,
      'an instruction to press a button that is already running is worse than silence')
  }
  check('the background one says the tab can be closed',
    /close this tab/i.test(nextStep({ ...staged, draining: true }).detail),
    'that is the entire reason to choose it, and it was only in a title attribute')

  // AND IT STOPS TELLING YOU ONCE IT IS DONE. The green line on the old screen
  // still said "now click merge" underneath a finished merge.
  const done = nextStep({ ...staged, merged: true })
  check('a finished merge stops asking for one',
    done.button === null && done.waiting,
    'the old screen still said "now click merge" under the words "merge finished"')
  check('and explains why staging still shows rows',
    /flags them in place/.test(done.detail),
    'a number that does not go down after a merge reads as a merge that did not work')
}

// ── it is actually on the page ──────────────────────────────────────────────
{
  check('the page renders the next step',
    /nextStep\(\{/.test(PAGE_LIVE) && /Do this next/.test(PAGE),
    'a helper nothing renders changes nothing')
  check('and goes quiet rather than nagging when there is nothing to do',
    /Nothing to press/.test(PAGE),
    'a permanent instruction is one nobody reads')
}

// ── the words themselves ────────────────────────────────────────────────────
{
  // EVERY BRANCH, not the ones that came to mind. The first version of this
  // swept four states and missed the upload branch entirely, so a dash typed
  // into that sentence passed. A sweep that does not reach a branch is not
  // checking that branch, it is just quiet about it.
  const states: ImportState[] = [
    base,
    { ...base, filesPicked: 1 },
    { ...base, filesPicked: 3 },
    { ...base, stagingEmpty: true },
    { ...base, stagingEmpty: false },
    { ...base, stagingEmpty: false, addOnly: false },
    { ...base, stagingEmpty: false, merged: true },
    { ...base, stagingEmpty: false, merging: true },
    { ...base, stagingEmpty: false, draining: true },
    { ...base, uploaded: true },
  ]
  const seen = new Set(states.map((st) => nextStep(st).title))
  check('the sweep reaches every branch',
    seen.size >= 6, `${seen.size} distinct steps reached`)
  const copy = [
    ...states.flatMap((st) => Object.values(nextStep(st))),
    mergeLabel(true), mergeLabel(false), backgroundLabel(true), backgroundLabel(false),
  ].filter((v) => typeof v === 'string').join(' ')
  check('no dash punctuation in anything a creator reads',
    !/[—–]/.test(copy), (copy.match(/.{0,40}[—–].{0,40}/) ?? [''])[0])
  check('no year stamped into the copy', !/\b20\d\d\b/.test(copy))
}

if (failures.length) {
  console.error(`\n❌ cc-import-steps: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ cc-import-steps: one label, one next step, and an instruction that names a button that is actually there')
