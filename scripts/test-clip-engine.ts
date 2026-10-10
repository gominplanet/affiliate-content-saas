// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Clip Factory's engine (Seb, 2026-10-10: "im not a huge fan of the clips it
// produces"): clips open and close on whole sentences, the hook is shown,
// "Trim silences" cuts silences, power words are coloured, and an answer MVP
// cannot read is said rather than shown as "no moments".

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sentenceUnits, snapToSentences, silenceCuts } from '../lib/shorts-snap'
import { cuesToTimestampedText } from '../lib/shorts-transcript'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// Word-level transcript, as Whisper gives it: three sentences.
const words = (s: string, t0: number) => s.split(' ').map((w, i) => ({ start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.35, text: w }))
const cues = [
  ...words('So I tested this amp for a whole month at every gig I played.', 0),       // 0 to ~5.6
  ...words('The tone is warmer than my old tube rig and it weighs a third.', 6.2),     // ~6.2 to ~11.8
  ...words('Honestly it changed how I pack for shows, and that is the payoff.', 12.4), // ~12.4 to ~18
  ...words('Next I tried the headphone out at home.', 18.8),
]

const units = sentenceUnits(cues)
check('the transcript reads as whole sentences', units.length === 4, String(units.length))
const mid = snapToSentences(cues, 2.1, 17, 10, 20)
check('a start mid-sentence moves back to the sentence\'s first word', !!mid && mid.start <= 0.01, JSON.stringify(mid))
check('the end lands right after a finished sentence', !!mid && Math.abs(mid.end - (cues[cues.findIndex((c) => c.text === 'payoff.')].end + 0.3)) < 0.31, JSON.stringify(mid))
const near = snapToSentences(cues, 13.5, 26, 5, 30)
check('a start a second into a sentence moves back to its first word', !!near && near.start < 12.4 && near.start > 12.2, JSON.stringify(near))
const long = [...words(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ') + '.', 0), ...words('Short one here.', 12.5), ...words('And a closing line that lands.', 14.5)]
const far = snapToSentences(long, 9, 18, 3, 10)
check('a start far into a long sentence moves to the NEXT sentence instead', !!far && far.start >= 12.3, JSON.stringify(far))
check('no sentence-clean window fits: null, so the word edges are used', snapToSentences(cues, 0, 3, 1, 2) === null)
const pad = snapToSentences(cues, 6.5, 12, 4, 8)
check('a breath of room either side, never into the neighbouring word', !!pad && pad.start >= cues[words('So I tested this amp for a whole month at every gig I played.', 0).length - 1].end && pad.start < 6.2, JSON.stringify(pad))

// Trim silences.
const clip = [
  { startSec: 0.2, endSec: 0.6, text: 'This' }, { startSec: 0.6, endSec: 1.0, text: 'costs' },
  { startSec: 2.5, endSec: 2.9, text: 'forty' }, { startSec: 2.9, endSec: 3.3, text: 'dollars.' },
]
const cut = silenceCuts(clip, 5)
check('a long pause is cut and short ones stay', cut.segments.length >= 2 && cut.savedSec > 1, JSON.stringify(cut))
check('caption words move onto the shortened timeline', cut.words[2].startSec < 2.5 && Math.abs((cut.words[2].startSec - cut.words[1].endSec) - 0.18) < 0.02, JSON.stringify(cut.words))
check('word lengths are kept', cut.words.every((w, i) => Math.abs((w.endSec - w.startSec) - (clip[i].endSec - clip[i].startSec)) < 0.02))
check('a clip with no dead air is left as one stretch', silenceCuts([{ startSec: 0, endSec: 1, text: 'a' }, { startSec: 1.1, endSec: 2, text: 'b' }], 2).segments.length === 1)

// The planner sees when each line ENDS, and is told to cut on sentences.
check('the planner transcript shows start and end of each line', /^\[00:00-00:01\]/.test(cuesToTimestampedText([{ start: 0, end: 0.6, text: 'Hi.' }], 16000, { withEnds: true })))
check('other callers keep the old format', /^\[00:00\] Hi\./.test(cuesToTimestampedText([{ start: 0, end: 0.6, text: 'Hi.' }])))
const planner = read('lib/shorts-planner.ts')
check('the planner snaps to sentences first', /snapToSentences\(cues, ws, we, minSec, maxSec\) \?\? snapWindow/.test(planner))
check('Shorts are told to open and close on whole sentences', /Start on the FIRST word of a sentence/.test(planner))
check('an unreadable answer is asked again with room, then said', /max_tokens: 4000/.test(planner) && /throw new PlanUnreadableError\(\)/.test(planner))
const plan = read('app/api/youtube/shorts/plan/route.ts')
check('the page is told the answer was unreadable, not "no moments"', /err instanceof PlanUnreadableError/.test(plan) && /unreadable: true/.test(plan))

// The render route and both screens.
const route = read('app/api/youtube/shorts/render/route.ts')
check('the hook is sent unless turned off', /const withHook = body\.hook !== false/.test(route) && /renderOpts\.hook = String\(short\.hook\)/.test(route))
check('Trim silences is used, not ignored', /body\.trimSilence === true/.test(route) && /silenceCuts\(cuesWithHl/.test(route) && /renderOpts\.segments = cut\.segments/.test(route))
check('the backup renderer shows the hook too', /hook: renderOpts\.hook \?\? ''/.test(route))
check('the answer says whether silences were cut', /trimmedSec:/.test(route) && /trimSkipped:/.test(route))
const ingest = read('lib/youtube-ingest.ts')
check('the hook and the cuts reach the render service', /hook: opts\.hook/.test(ingest) && /segments: opts\.segments/.test(ingest))
for (const f of ['components/vertical/ShortsCreatePanel.tsx', 'components/content/ShortsStudioModal.tsx']) {
  const src = read(f)
  check(`${f.split('/').pop()}: Hook title and Trim silences are offered and sent`, /Hook title/.test(src) && /Trim silences/.test(src) && /hook: hookById\[clip\.id\] !== false/.test(src) && /trimSilence: trimById\[clip\.id\] === true/.test(src))
  check(`${f.split('/').pop()}: the toast says when silences were or were not cut`, /without trimming silences/.test(src) && /of silence cut/.test(src))
}
const server = read('ingest-service/server.js')
check('the render service burns the hook and cuts the silences', /buildAss\(words, \{ hook \}\)/.test(server) && /keepSegments\(req\.body\?\.segments, dur\)/.test(server) && /trimFilters\(segs\)/.test(server))
check('a trimmed render keeps every frame', /'-fps_mode', 'passthrough'/.test(server))
check('the Docker image ships the caption code', /COPY server\.js render-filters\.js/.test(read('ingest-service/Dockerfile')))

if (failed) { console.error(`\n${failed} clip engine check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
