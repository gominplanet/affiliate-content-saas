// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR (Seb, 2026-10-30). Pinned: the take is broken into lines;
// cut lines go, pauses over half a second shrink, the rest is kept whole; the
// B-roll lands under its line, never in the opening, never overlapping;
// zooms run from a strong line to the next cut; captions follow the cuts; a
// planner answer is checked against the take; settings are made safe.
import { cleanWords, linesOf, keepSegments, snapSegments, editLength, toOutput, outputWords, insertsFor, zoomsFor, cleanSettings, renderSpec, findWords, cutLines, PACE, DEFAULT_SETTINGS, withoutSilences, whenSaid, pictureTimes, MAX_PICTURES, type Word } from '../lib/review-edit'
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
check('a zoom lasts long enough to see: 2 to 8 seconds, from the strong line', zooms.length >= 1 && zooms.every(([a, b]) => b - a >= 2 && b - a <= 8), zooms)

// ── Dead air from the sound itself (Seb, 2026-10-30: "still a lot of dead air") ─
{
  // Word timings stretch into the pause, so the words alone keep it; the
  // sound says 6.0 to 7.2 is quiet.
  // "part" is said 5.68 to 6.08, but its timing runs on to 7.2.
  const ws = cleanWords([...say(4, 'This is the best', 0.02, 0.4), { start: 5.68, end: 7.2, text: 'part' }, ...say(7.25, 'and it lasts all day.', 0.02, 0.4)])
  const ls = linesOf(ws)
  const kept = keepSegments(ws, ls, [], 12, PACE.review)
  const tight = keepSegments(ws, ls, [], 12, PACE.review, [[6.1, 7.2]])
  const gapOut = (seg: [number, number][]) => (toOutput(seg, 7.25) ?? 0) - (toOutput(seg, 6.09) ?? 0)
  check('a quiet stretch the sound shows is cut, though the word timings hid it', gapOut(tight) < gapOut(kept) - 0.8 && gapOut(tight) < 0.35, [gapOut(kept), gapOut(tight)])
  check('a little is kept after the last sound and before the next', withoutSilences([[0, 10]], [[4, 5]], PACE.review).map(([a, b]) => [a, b].map((x) => Math.round(x * 100) / 100)).join() === '0,4.1,4.95,10')
  check('a short breath is left alone', withoutSilences([[0, 10]], [[4, 4.25]], PACE.review).length === 1 && withoutSilences([[0, 10]], [[4, 4.25]], PACE.trybe).length === 2)
  check('a TRYBE ad keeps less around each cut than a review', PACE.trybe.tailKeep < PACE.review.tailKeep && PACE.trybe.minSilence < PACE.review.minSilence)
}

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
const stamp = cleanSettings({ logo: { url: 'https://x/logo.png', position: 'upper-right', opacity: 0.48, size: 'large' } })
check('the logo can be a see-through stamp, at a size, and snaps to the looks offered', !!stamp.logo && stamp.logo.opacity === 0.5 && stamp.logo.size === 'large' && cleanSettings({ logo: { url: 'https://x/l.png' } }).logo!.opacity === 1 && cleanSettings({ logo: { url: 'https://x/l.png', size: 'huge' } }).logo!.size === 'medium')
check('switches off stay off', cleanSettings({ zooms: false, color: false }).zooms === false && cleanSettings({ zooms: false }).color === true)

const spec = renderSpec({ words, lines, plan: { cuts, keys: [4], placements: [{ shot: 1, line: 3, why: '' }], title: '' }, shots, duration: 14, settings: cleanSettings({ kind: 'review' }), hasBroll: true })
const plain = { cuts, keys: [], placements: [], title: '' }
const adSpec = renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'trybe', logo: { url: 'https://x/logo.png', on: true } }), hasBroll: false })
check('captions are only on a TRYBE ad', spec.words.length === 0 && adSpec.words.length > 0)
check('a TRYBE ad never carries the creator\u2019s logo; a review does when it is on', adSpec.logo === null && renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'review', logo: { url: 'https://x/logo.png', on: true } }), hasBroll: false }).logo !== null)
check('a TRYBE ad is cut tighter: shorter pauses, so a shorter video from the same take', adSpec.seconds < renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'review' }), hasBroll: false }).seconds)
check('an ad\u2019s B-roll may come sooner and is shorter', PACE.trybe.brollNotBefore < PACE.review.brollNotBefore && PACE.trybe.brollMax < PACE.review.brollMax && PACE.trybe.maxPause < PACE.review.maxPause)
check('B-roll switched off, or no B-roll take, sends none', renderSpec({ words, lines, plan: { cuts, keys: [], placements: [{ shot: 1, line: 3, why: '' }], title: '' }, shots, duration: 14, settings: { ...DEFAULT_SETTINGS, broll: false }, hasBroll: true }).inserts.length === 0 && spec.inserts.length === 1)

// ── The logo's moment (Seb, 2026-10-30: first 5 seconds, last 5, the whole video, or none) ──
{
  const l = (x: object) => cleanSettings({ logo: { url: 'https://x/l.png', ...x } }).logo!
  check('a logo is on the whole video unless chosen, and five seconds when at the start or the end', l({}).when === 'whole' && l({ when: 'start' }).seconds === 5 && l({ when: 'end', seconds: 8 }).seconds === 8 && l({ when: 'sometimes' }).when === 'whole')
  check('none at all is the logo switched off', renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'review', logo: { url: 'https://x/l.png', on: false } }), hasBroll: false }).logo === null)
  check('a picture shows five seconds at the start or the end unless chosen', cleanSettings({ pictures: [{ url: 'https://x/p.png', when: 'start' }] }).pictures[0].seconds === 5)
}

// ── Title looks and pictures (Seb, 2026-10-30) ──────────────────────────────
{
  const t = cleanSettings({ title: { text: 'PROVIDED SAMPLE IN EXCHANGE FOR VIDEO REVIEW #AD', position: 'lower-left', seconds: 0, on: true, look: 'caps', color: 'yellow', size: 'large' } }).title
  check('a title has a look, a colour and a size, and can stay for the whole video', t.look === 'caps' && t.color === 'yellow' && t.size === 'large' && t.seconds === 0 && t.position === 'lower-left' && t.text.length === 48, t)
  const odd = cleanSettings({ title: { look: 'wingdings', color: 'chartreuse', size: 'huge', seconds: 99 } }).title
  check('an unknown look, colour or size falls back to the plain ones, and a time is kept between 2 and 15 seconds', odd.look === 'clean' && odd.color === 'white' && odd.size === 'medium' && odd.seconds === 15, odd)
  const kept = cleanSettings({ zooms: false }, cleanSettings({ title: { seconds: 0, look: 'marker' } }))
  check('a change that does not touch the title keeps its whole video timing and its look', kept.title.seconds === 0 && kept.title.look === 'marker', kept.title)
  check('an older saved video, from before looks, gets the plain look', cleanSettings({ title: { text: 'x', position: 'top', seconds: 4, on: true } }).title.look === 'clean')

  const u = (n: number) => `https://x.supabase.co/storage/v1/object/public/instagram-videos/u1/pic-${n}.png`
  const ps = cleanSettings({ pictures: [{ url: u(1), position: 'center', size: 'large', opacity: 0.52, when: 'say', say: 'link \u2014 below', seconds: 40 }, { url: 'javascript:alert(1)' }, { url: u(1) }, { url: u(2), when: 'say', say: '  ' }, { url: u(3) }, { url: u(4) }, { url: u(5) }] }).pictures
  check('pictures are made safe: https only, no twice, four at most', ps.length === MAX_PICTURES && ps.every((p) => p.url.startsWith('https://')) && new Set(ps.map((p) => p.url)).size === ps.length, ps.map((p) => p.url))
  check('a picture keeps its spot, size and see-through look, and a time up to 15 seconds', ps[0].position === 'center' && ps[0].size === 'large' && ps[0].opacity === 0.5 && ps[0].seconds === 15 && ps[0].say === 'link below', ps[0])
  check('a picture told to wait for no words shows at the start instead', ps[1].when === 'start', ps[1])
  check('no pictures unless added', cleanSettings({}).pictures.length === 0)

  // A take: "this hoodie is great, link below for the price"; "great" cut.
  const w2: Word[] = say(0, 'this hoodie is great link below for the price', 0.05, 0.3)
  const segs2: [number, number][] = [[0, 1.0], [1.4, 3.2]]
  check('words said in a kept part are found, ignoring case and punctuation, at their place in the finished video', whenSaid(w2, segs2, 'Link, below!') === toOutput(segs2, w2[4].start) && whenSaid(w2, segs2, 'link below') !== null)
  check('words cut from the video, or never said, are not found', whenSaid(w2, segs2, 'great') === null && whenSaid(w2, segs2, 'free shipping') === null && whenSaid(w2, segs2, '') === null)
  const base = { url: 'https://x/p.png', on: true, position: 'lower-right' as const, size: 'medium' as const, opacity: 1, seconds: 4, say: '' }
  const len = editLength(segs2)
  const times = pictureTimes([
    { ...base, when: 'whole' }, { ...base, when: 'start' }, { ...base, when: 'end' },
    { ...base, when: 'say', say: 'link below' }, { ...base, when: 'say', say: 'free shipping' }, { ...base, when: 'whole', on: false },
  ], w2, segs2, len)
  const at = (k: number) => times.find((x) => x.k === k)! as { k: number; url: string; from: number; to: number; missed?: string }
  check('the whole video, the start, the end', 'from' in at(0) && at(0).from === 0 && 'to' in at(0) && Math.abs(at(0).to - len) < 0.01
    && 'from' in at(1) && at(1).from === 0.3 && 'from' in at(2) && Math.abs(at(2).from - Math.max(0, len - 4)) < 0.01, times)
  const sayIt = at(3)
  check('when I say: from the moment the words are said, for its seconds, never past the end', 'from' in sayIt && Math.abs(sayIt.from - whenSaid(w2, segs2, 'link below')!) < 0.001 && sayIt.to <= len + 0.001, sayIt)
  check('words never said leave the picture out and say why, never quietly', 'missed' in at(4) && /free shipping/.test((at(4) as { missed: string }).missed))
  check('a picture switched off is not listed', !times.some((x) => x.k === 5))
  const withPics = renderSpec({ words, lines, plan: plain, shots, duration: 14, settings: cleanSettings({ kind: 'trybe', pictures: [{ url: 'https://x/p.png' }] }), hasBroll: false })
  check('pictures go on a TRYBE ad too: they are the creator\u2019s choice, not their logo', withPics.pictures.length === 1 && 'from' in withPics.pictures[0])
}

if (fails.length) { console.error(`\n❌ review-edit: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit: mistakes and long pauses cut, B-roll under its line, zooms to the next cut, captions on the new timing, plans checked')
