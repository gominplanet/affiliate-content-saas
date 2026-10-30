// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR (Seb, 2026-10-30). Pinned: the take is broken into lines;
// cut lines go, pauses over half a second shrink, the rest is kept whole; the
// B-roll lands under its line, never in the opening, never overlapping;
// zooms run from a strong line to the next cut; captions follow the cuts; a
// planner answer is checked against the take; settings are made safe.
import { cleanWords, linesOf, keepSegments, snapSegments, editLength, toOutput, outputWords, insertsFor, zoomsFor, cleanSettings, renderSpec, findWords, cutLines, PACE, DEFAULT_SETTINGS, type Word } from '../lib/review-edit'
import { cleanPlan, jsonIn } from '../lib/review-edit-plan'
import { snapSegments as serverSnap, editSeconds as serverSeconds } from '../ingest-service/edit-filters'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

// A made-up take: an opening, a restart, a long pause, a verdict.
const say = (start: number, text: string, gap = 0.05, per = 0.3): Word[] => {
  let t = start
  return text.split(' ').map((w) => { const x = { start: t, end: t + per, text: w }; t += per + gap; return x })
}
const words: Word[] = cleanWords([
  ...say(0.5, 'is it recording okay'),          // 0: chatter
  ...say(3.0, 'This hoodie is the best.'),      // 1
  ...say(5.0, 'It keeps the sun off and'),      // 2: restart
  ...say(7.6, 'It keeps the sun off all day.'), // 3
  ...say(11.0, 'My verdict, buy it.'),          // 4: after a long pause
])
const lines = linesOf(words)
check('the take is broken into lines at pauses and sentence ends', lines.length === 5 && lines[1].text === 'This hoodie is the best.' && lines[3].text === 'It keeps the sun off all day.', lines.map((l) => l.text))

// A restart with no pause before the retake: both tries on one line.
const run = cleanWords([...say(0, 'Hi there.'), ...say(1.2, 'It keeps the sun off and it keeps the sun off all day.')])
const runLines = linesOf(run)
const part = findWords(run, runLines[1], 'It keeps the sun off and')
check('the planner can quote the false start inside a line', !!part && run[part![0]].text === 'It' && run[part![1]].text === 'and' && part![1] - part![0] === 5, part)
const runSegs = keepSegments(run, runLines, [{ from: 1, to: 1, kind: 'restart', why: '', words: part! }], 20)
check('only the quoted words go; the retake stays', toOutput(runSegs, run[part![0]].start + 0.1) === null && toOutput(runSegs, run[part![1] + 1].start + 0.05) !== null, runSegs)
check('the room kept around a word never reaches into a cut word', runSegs.every(([a, b]) => !(a < run[part![1]].end && b > run[part![0]].start)), runSegs)
check('a line cut in part is not counted as cut whole', !cutLines(runLines, [{ from: 1, to: 1, kind: 'restart', why: '', words: part! }]).has(1))
check('words not in the line are not found', findWords(run, runLines[1], 'totally different words') === null)

const cuts = [{ from: 0, to: 0, kind: 'chatter' as const, why: 'Talk before the review.' }, { from: 2, to: 2, kind: 'restart' as const, why: 'You started over.' }]
const segs = keepSegments(words, lines, cuts, 14)
check('cut lines go, the rest is kept with a little room either side', segs.length === 3 && Math.abs(segs[0][0] - (3.0 - 0.08)) < 0.04, segs)
check('nothing kept is from a cut line', toOutput(segs, 0.8) === null && toOutput(segs, 5.5) === null)
check('the long pause before the verdict is shortened, not kept', (() => { const gapOut = toOutput(segs, lines[4].start)! - toOutput(segs, lines[3].end - 0.01)!; return gapOut < 0.4 })())
check('the last line keeps half a second after the last word', Math.abs(segs[segs.length - 1][1] - Math.round((lines[4].end + 0.5) * 30) / 30) < 0.04, segs)
check('a cut put back is kept again', keepSegments(words, lines, [{ ...cuts[0], restored: true }, cuts[1]], 14)[0][0] < 1)
check('the parts are on the frame grid, exactly as the video server makes them', (() => {
  const s = serverSnap(segs)
  return !!s && s.length === segs.length && s.every((x: { ka: number; kb: number }, i: number) => x.ka === Math.round(segs[i][0] * 30) && x.kb === Math.round(segs[i][1] * 30)) && Math.abs(serverSeconds(s) - editLength(segs)) < 1e-3
})())
check('touching parts are one part', JSON.stringify(snapSegments([[0, 1], [1, 2], [3, 3.01]])) === JSON.stringify([[0, 2]]))

const capt = outputWords(words, segs)
check('captions leave out the cut words and follow the new timing', !capt.some((w) => w.text === 'recording') && capt[0].text === 'This' && capt[0].start < 0.2, capt.slice(0, 2))

const shots = [{ n: 1, start: 0, end: 6, what: 'the hoodie hood' }, { n: 2, start: 6, end: 7, what: 'too short' }, { n: 3, start: 8, end: 14, what: 'sleeve' }]
const ins = insertsFor([{ shot: 1, line: 3, why: '' }, { shot: 2, line: 4, why: '' }, { shot: 3, line: 1, why: '' }, { shot: 3, line: 2, why: 'cut line' }], shots, lines, segs)
check('B-roll goes under its line (or after the opening), starting a little into the shot', ins.some((x) => Math.abs(x.at - Math.max(2.5, Math.round((toOutput(segs, lines[3].start + 0.2)!) * 30) / 30)) < 0.04 && x.from === 0.3), ins)
check('never in the opening seconds, never longer than four seconds, never overlapping', ins.every((x, i) => x.at >= 2.5 && x.len <= 4 && (i === 0 || x.at >= ins[i - 1].at + ins[i - 1].len)), ins)
check('a shot too short, or under a cut line, is not used', !ins.some((x) => x.from >= 6 && x.from < 7))

const zooms = zoomsFor([4, 1, 99], lines, segs)
check('a slow zoom runs from a strong line to the next cut', zooms.length >= 1 && zooms.every(([a, b]) => b - a >= 1.5 && b - a <= 8), zooms)

// ── The planner's answer is checked ──────────────────────────────────────────
const quoted = cleanPlan({ cuts: [{ from: 1, to: 1, text: 'it keeps the sun off and', kind: 'restart' }, { from: 1, to: 1, text: 'not said', kind: 'restart' }] }, runLines, [], run)
check('a quoted false start becomes a cut of those words; a quote not in the line is dropped', quoted.cuts.length === 1 && JSON.stringify(quoted.cuts[0].words) === JSON.stringify(part), quoted.cuts)
const plan = cleanPlan(jsonIn('Here you go: {"cuts":[{"from":0,"to":0,"kind":"chatter","why":"Talk before — the review."},{"from":0,"to":1,"kind":"restart","why":"overlaps"},{"from":7,"to":9,"why":"no such line"}],"keys":[4,4,99],"placements":[{"shot":1,"line":3},{"shot":1,"line":4},{"shot":9,"line":2}],"title":"Sun Hoodie — 2026"} trailing'), lines, shots)
check('a cut that overlaps another, or names lines that do not exist, is dropped', plan.cuts.length === 1 && plan.cuts[0].from === 0, plan.cuts)
check('no dashes reach the creator', !/[–—]/.test(plan.cuts[0].why + plan.title))
check('each shot once, only shots that exist', plan.placements.length === 1 && plan.placements[0].shot === 1)
check('keys are real lines, once each', JSON.stringify(plan.keys) === '[4]')
check('a plan that cuts every line cuts nothing', cleanPlan({ cuts: [{ from: 0, to: 4, kind: 'chatter' }] }, lines, []).cuts.length === 0)
check('a reply with no JSON is an empty plan, not an error', cleanPlan(jsonIn('sorry'), lines, []).cuts.length === 0)

// ── Settings ─────────────────────────────────────────────────────────────────
const s1 = cleanSettings({ formats: ['vertical', 'square'], logo: { url: 'javascript:alert(1)', position: 'upper-left' }, title: { text: 'Best \u2014 hoodie', position: 'nowhere', seconds: 99 } })
check('the format follows what the video is for, never a list sent in', JSON.stringify(s1.formats) === '["wide"]' && JSON.stringify(cleanSettings({ kind: 'trybe' }).formats) === '["vertical"]' && cleanSettings({ kind: 'square' }).kind === 'review')
check('a logo that is not a web address is no logo', s1.logo === null)
check('title: no dashes, a known position, 2 to 15 seconds', s1.title.text === 'Best, hoodie' && s1.title.position === 'top' && s1.title.seconds === 15)
const s2 = cleanSettings({ logo: { url: 'https://x/logo.png', position: 'lower-right' } })
check('a logo keeps its place and is on', !!s2.logo && s2.logo.position === 'lower-right' && s2.logo.on === true)
check('switches off stay off', cleanSettings({ zooms: false, color: false }).zooms === false && cleanSettings({ zooms: false }).color === true)

const spec = renderSpec({ words, lines, plan: { cuts, keys: [4], placements: [{ shot: 1, line: 3, why: '' }], title: '' }, shots, duration: 14, settings: cleanSettings({ kind: 'review' }), hasBroll: true })
const plain = { cuts, keys: [], placements: [], title: '' }
const adSpec = renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'trybe', logo: { url: 'https://x/logo.png', on: true } }), hasBroll: false })
check('captions are only on a TRYBE ad', spec.words.length === 0 && adSpec.words.length > 0)
check('a TRYBE ad never carries the creator\u2019s logo; a review does when it is on', adSpec.logo === null && renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'review', logo: { url: 'https://x/logo.png', on: true } }), hasBroll: false }).logo !== null)
check('a TRYBE ad is cut tighter: shorter pauses, so a shorter video from the same take', adSpec.seconds < renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'review' }), hasBroll: false }).seconds)
check('an ad\u2019s B-roll may come sooner and is shorter', PACE.trybe.brollNotBefore < PACE.review.brollNotBefore && PACE.trybe.brollMax < PACE.review.brollMax && PACE.trybe.maxPause < PACE.review.maxPause)
check('B-roll switched off, or no B-roll take, sends none', renderSpec({ words, lines, plan: { cuts, keys: [], placements: [{ shot: 1, line: 3, why: '' }], title: '' }, shots, duration: 14, settings: { ...DEFAULT_SETTINGS, broll: false }, hasBroll: true }).inserts.length === 0 && spec.inserts.length === 1)

if (fails.length) { console.error(`\n❌ review-edit: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit: mistakes and long pauses cut, B-roll under its line, zooms to the next cut, captions on the new timing, plans checked')
