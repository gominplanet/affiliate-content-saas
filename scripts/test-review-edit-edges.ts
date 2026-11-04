// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHERE A VIDEO REALLY STARTS AND ENDS (Seb, 2026-11-04).
//
// "Michelle started the camera, walked in front of it, said a few things, got
// ready, and then started talking. The first 5 seconds of the edited video,
// you saw her walk in front, get ready, and then start. That should have been
// cut. And at the end, she walks to the camera, talking to herself and making
// a face. That also should have been cut."
//
// Pinned here: words stretched over the walk-in are put back to their size,
// the pictures looked at are the start and the end, the planner's start and
// end become cuts that say why, the walk-off with no words is cut from the
// pictures, and a plan made without the pictures says so.
import { readFileSync } from 'node:fs'
import { tidyWordTimes, wordMax, edgeMoments, linesOf, keepSegments, renderSpec, cleanSettings, PACE, type Word } from '../lib/review-edit'
import { cleanPlan, edgeLines } from '../lib/review-edit-plan'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const W = (text: string, start: number, end: number): Word => ({ text, start, end })

// ── WORDS STRETCHED OVER WHAT WAS NOT SAID ───────────────────────────────────
check('a short word takes at most 0.7 seconds, a long one more, never over 1.8',
  wordMax('hi') === 0.7 && wordMax('unbelievable') > 1.3 && wordMax('unbelievable') < 1.5 && wordMax('x'.repeat(40)) === 1.8)
{
  // The speech service hears "hi" from 0.0 to 5.2: the whole walk-in.
  const raw = [W('hi', 0, 5.2), W('guys,', 5.22, 5.6), W('today', 5.7, 6.0), W('I', 6.05, 6.15), W('review', 6.2, 6.6), W('this.', 6.65, 7.0)]
  const t = tidyWordTimes(raw)
  check('a first word stretched over the walk-in starts where it was said', Math.abs(t[0].start - 4.5) < 0.01 && t[0].end === 5.2)
  check('words said at a normal speed are left alone', t.slice(1).every((w, k) => w.start === raw[k + 1].start && w.end === raw[k + 1].end))
  check('same words, same order, same count', t.length === raw.length && t.every((w, k) => w.text === raw[k].text))
  const segs = keepSegments(t, linesOf(t), [], 8, PACE.review)
  check('so the edit no longer opens on the walk-in', segs[0][0] > 4.3)
}
{
  // The last word comes back with no end, and is given two seconds.
  const raw = [W('see', 100, 100.2), W('you', 100.25, 100.4), W('soon.', 100.45, 102.45)]
  const t = tidyWordTimes(raw)
  check('a last word stretched over the walk-off ends where it was said', t[2].start === 100.45 && Math.abs(t[2].end - (100.45 + wordMax('soon.'))) < 0.01)
}
{
  const raw = [W('so', 10, 10.2), W('reaaally', 10.25, 13.5), W('good', 15, 15.3)]
  const t = tidyWordTimes(raw)
  check('a word with room after it and none before keeps its start', t[1].start === 10.25 && t[1].end < 13.5)
}

// ── THE PICTURES LOOKED AT ───────────────────────────────────────────────────
{
  const words = [W('okay', 2, 2.3), ...Array.from({ length: 200 }, (_, i) => W('word', 6 + i * 0.5, 6.3 + i * 0.5)), W('bye', 108, 108.3)]
  const m = edgeMoments(words, 115)
  check('the start is looked at, from the beginning to a while after the first word', m[0] < 1 && m.some((t) => t > 9 && t < 11.5) && !m.some((t) => t > 12 && t < 98))
  check('the end is looked at, from a while before the last word to the end', m.some((t) => t > 99 && t < 101) && m[m.length - 1] > 114 && m[m.length - 1] < 115)
  check('at most 32 pictures, in order, never the same moment twice, all inside the take',
    m.length <= 32 && m.every((t, k) => k === 0 || t - m[k - 1] >= 0.3) && m.every((t) => t > 0 && t < 115))
  const short = edgeMoments([W('hi', 1, 1.2), W('bye', 6, 6.3)], 8)
  check('a short take is looked at once, not twice over', short.every((t, k) => k === 0 || t - short[k - 1] >= 0.3) && short.length <= 32)
  check('no words or no length, no pictures', edgeMoments([], 10).length === 0 && edgeMoments(words, 0).length === 0)
}

// ── MICHELLE'S TAKE ──────────────────────────────────────────────────────────
// Walks in saying "okay, is it on", gets ready, "hi guys" twice (the first
// one still walking), the review, the sign-off, then "okay, that was good"
// on her way to the camera.
const take = tidyWordTimes([
  W('okay,', 0.4, 0.8), W('is', 0.9, 1.0), W('it', 1.05, 1.15), W('on?', 1.2, 1.5),
  W('hi', 2.6, 2.8), W('guys.', 2.85, 3.2),
  W('Hi', 6.0, 6.2), W('guys,', 6.25, 6.5), W('today', 6.6, 6.9), W('we', 6.95, 7.05), W('look', 7.1, 7.3), W('at', 7.35, 7.4), W('this', 7.45, 7.6), W('projector.', 7.65, 8.2),
  W('It', 9.0, 9.1), W('is', 9.15, 9.25), W('bright', 9.3, 9.6), W('and', 9.65, 9.75), W('quiet.', 9.8, 10.3),
  W('Thanks', 11.5, 11.8), W('for', 11.85, 11.95), W('watching.', 12.0, 12.5),
  W('Okay,', 14.0, 14.3), W('that', 14.35, 14.5), W('was', 14.55, 14.7), W('good.', 14.75, 15.1),
])
const lines = linesOf(take)
const at = (word: string) => lines.findIndex((l) => l.text.startsWith(word))
const first = at('Hi guys, today'), last = at('Thanks')
check('the take breaks into lines the test expects', first > 0 && last > first && last < lines.length - 1)

const plan = cleanPlan({ start: first, end: last, setup: 'You walked in and got ready before you started.', walkoff: 'You walked to the camera after your sign-off.', endAt: 13.2, cuts: [], keys: [], placements: [], title: 'Projector', product: '' }, lines, [], take)
const head = plan.cuts.find((c) => c.edge === 'start')
const tail = plan.cuts.find((c) => c.edge === 'end')
check('everything before the first line to the viewer is cut, and says why', !!head && head.from === 0 && head.to === first - 1 && head.kind === 'chatter' && /walked in/.test(head.why))
check('everything after the last line to the viewer is cut, and says why', !!tail && tail.from === last + 1 && tail.to === lines.length - 1 && /camera/.test(tail.why))
check('the walk-off moment from the pictures is kept on the plan', plan.endAt === 13.2)
{
  const segs = keepSegments(take, lines, plan.cuts, 16, PACE.review)
  check('the edit opens on her real "Hi guys", not the walk-in', segs[0][0] > 5.8 && segs[0][0] < 6.0)
  check('the edit stops after "Thanks for watching", not on her way to the camera', segs[segs.length - 1][1] < 13.3)
}
{
  // No words after the sign-off, only a face: the pictures say when it starts.
  const quiet = take.filter((w) => w.start < 13)
  const ql = linesOf(quiet)
  const qp = cleanPlan({ start: first, end: ql.length - 1, setup: '', walkoff: '', endAt: 12.8, cuts: [], keys: [], placements: [], title: '', product: '' }, ql, [], quiet)
  const spec = renderSpec({ words: quiet, lines: ql, plan: qp, shots: [], duration: 16, settings: cleanSettings({}), hasBroll: false })
  check('a silent face after the last line is cut where the pictures show it', spec.segments[spec.segments.length - 1][1] <= 12.8 + 1e-6)
  const without = renderSpec({ words: quiet, lines: ql, plan: { ...qp, endAt: undefined }, shots: [], duration: 16, settings: cleanSettings({}), hasBroll: false })
  check('without the pictures the end is as before', without.segments[without.segments.length - 1][1] > 12.9)
  // Putting the walk-off back is never undone by the moment it was seen.
  const back = { ...plan, cuts: plan.cuts.map((c) => (c.edge === 'end' ? { ...c, restored: true } : c)) }
  const all = renderSpec({ words: take, lines, plan: back, shots: [], duration: 16, settings: cleanSettings({}), hasBroll: false })
  check('a walk-off put back by the creator plays in full', all.segments[all.segments.length - 1][1] > 15)
}

// ── NOT TRUSTED ──────────────────────────────────────────────────────────────
check('a start after the end cuts nothing', edgeLines({ start: 5, end: 2 }, lines).head === 0 && edgeLines({ start: 5, end: 2 }, lines).tail === lines.length - 1)
check('a start and end that would cut more than half of what was said cut nothing', (() => { const e = edgeLines({ start: lines.length - 1, end: lines.length - 1 }, lines); return e.head === 0 && e.tail === lines.length - 1 })())
check('no answer cuts nothing', edgeLines(null, lines).head === 0 && cleanPlan(null, lines, [], take).cuts.length === 0)
check('a walk-off moment before the last line is ignored', cleanPlan({ start: first, end: last, endAt: 8, cuts: [] }, lines, [], take).endAt === undefined)
check('a cut the planner gives inside the setup is not taken twice',
  cleanPlan({ start: first, end: last, cuts: [{ from: 0, to: 0, kind: 'chatter', text: '', why: 'x' }] }, lines, [], take).cuts.filter((c) => c.from === 0).length === 1)

// ── WIRED IN ─────────────────────────────────────────────────────────────────
const S = read('lib/review-edit-server.ts')
check('the reading puts stretched words back to their size', /tidyWordTimes\(cleanWords\(/.test(S))
check('the reading takes pictures of the start and the end, alongside the B-roll', /edgeMoments\(words, probe\.data\.duration\)/.test(S) && /at: moments, width: 320/.test(S) && S.indexOf('const edgeFrames') < S.indexOf("note: 'Looking through your B-roll'"))
check('pictures from an older video server, spread evenly, are not used', /fp\.data\.frames\.every\(\(f\) => moments\.some\(\(m\) => Math\.abs\(m - f\.at\) < 0\.05\)\)/.test(S))
check('the plan is given the pictures', /planEdit\(\{ words, lines, shots, product: row\.product, kind: kindNow, frames, who \}\)/.test(S))
check('the card says whether MVP watched the start and end', /MVP watched how it starts and ends\./.test(S) && /MVP could not watch how it starts and ends this time, so it cut from your words alone\./.test(S))
const P = read('lib/review-edit-plan.ts')
check('the plan is made by the strongest model, with a held answer shape', /const PLAN_MODEL = 'claude-opus-5-5'/.test(P) && /format: \{ type: 'json_schema', schema: PLAN_SCHEMA \}/.test(P) && /effort: 'medium'/.test(P))
check('a failed or slow plan falls back to the words-only planner, and says so', /timeout: 110_000, maxRetries: 0/.test(P) && /model: WORDS_ONLY_MODEL/.test(P) && /read: 'words' \}/.test(P))
check('both kinds of video are told where a video starts and ends', (P.match(/\n  EDGE_RULES,/g) || []).length === 2)
check('the old "when unsure, keep it" is for inside the review only', /Inside the review, when unsure, keep it\./.test(P))
const V = read('ingest-service/server.js')
check('the video server takes pictures at chosen moments', /Array\.isArray\(req\.body\?\.at\)/.test(V) && /const times = chosen && chosen\.length \? chosen :/.test(V))
const R = read('app/api/review-edit/route.ts')
check('a video can be cut again from the start, not counted twice', /if \(action === 'reread'\)/.test(R) && /status: 'queued', attempts: 0, note: 'In line to be read and cut again'/.test(R))
check('the button is there while the takes are', /Cut it again from the start/.test(read('components/review-editor/ReviewEditor.tsx')))

if (fails.length) {
  console.error(`\n❌ review-edit-edges: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ review-edit-edges: the walk-in and the walk-off are cut, from the words and the pictures, and a plan made without the pictures says so')
