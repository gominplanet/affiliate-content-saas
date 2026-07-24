// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Unit tests for the Shorts Studio caption/transcript math — the pure functions
// whose bugs would be invisible until a creator sees subtitles drifting off the
// words or a clip cut mid-sentence.
//
// Why a real test (not a review): the ms-vs-seconds transcript unit detection
// (normalizeCues) and the clip-relative caption timing (sliceCuesToWindow /
// buildCaptionChunks) are exactly the kind of arithmetic that silently breaks on
// a dependency bump or an "obvious" refactor. This asserts the invariants.
//
// Run: `npm run test:shorts` (wired into `npm run build`, like test:thumbnails).

import { normalizeCues, cuesToTimestampedText, parseSrtCues } from '../lib/shorts-transcript'
import { sliceCuesToWindow, buildCaptionChunks, captionsForClip, chunksToSrt } from '../lib/shorts-captions'
import { extractYouTubeVideoId } from '../lib/youtube-url'
import type { TranscriptCue } from '../lib/shorts-types'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('normalizeCues — unit detection')
{
  // Milliseconds: offsets/durations in the thousands, median duration > 50.
  const ms = normalizeCues([
    { text: 'hello there', offset: 0, duration: 2000 },
    { text: 'friends', offset: 2000, duration: 1500 },
    { text: 'today', offset: 3500, duration: 2500 },
  ])
  check('ms → seconds scales by 1000', Math.abs(ms[1].start - 2) < 0.01, `got ${ms[1].start}`)
  check('ms cue end = start + duration', Math.abs(ms[0].end - 2) < 0.01, `got ${ms[0].end}`)

  // Seconds already: small durations, passthrough.
  const sec = normalizeCues([
    { text: 'a', offset: 0, duration: 2 },
    { text: 'b', offset: 2, duration: 1.5 },
    { text: 'c', offset: 3.5, duration: 2 },
  ])
  check('seconds pass through unscaled', Math.abs(sec[1].start - 2) < 0.01, `got ${sec[1].start}`)

  // Robustness: empty text dropped, sorted, missing duration clamped.
  const messy = normalizeCues([
    { text: '  ', offset: 5, duration: 1 },
    { text: 'later', offset: 10, duration: 0 },
    { text: 'first', offset: 1, duration: 1 },
  ])
  check('empty-text cue dropped', messy.length === 2, `got ${messy.length}`)
  check('cues sorted by start', messy[0].text === 'first', `got ${messy[0].text}`)
  check('missing duration gets a width', messy[1].end > messy[1].start)
}

console.log('parseSrtCues — official-API SRT → timestamped cues')
{
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    'Hello and <b>welcome</b> back',
    '',
    '2',
    '00:00:03,500 --> 00:00:06,000',
    'today we test the projector',
    '',
  ].join('\n')
  const cues = parseSrtCues(srt)
  check('two cues parsed', cues.length === 2, `got ${cues.length}`)
  check('start parsed from HH:MM:SS,mmm', Math.abs(cues[0].start - 1) < 0.001, `got ${cues[0].start}`)
  check('end parsed with millis', Math.abs(cues[0].end - 3.5) < 0.001, `got ${cues[0].end}`)
  check('HTML tags stripped', cues[0].text === 'Hello and welcome back', cues[0].text)
  check('garbage in → empty out', parseSrtCues('not an srt at all').length === 0)
}

console.log('sliceCuesToWindow — clip-relative rebasing')
{
  const cues: TranscriptCue[] = [
    { start: 0, end: 5, text: 'intro' },
    { start: 10, end: 14, text: 'the good part' },
    { start: 14, end: 18, text: 'keeps going' },
    { start: 30, end: 34, text: 'outro' },
  ]
  const win = sliceCuesToWindow(cues, 10, 18)
  check('only overlapping cues kept', win.length === 2, `got ${win.length}`)
  check('window rebased to 0', win[0].start === 0, `got ${win[0].start}`)
  check('second cue offset preserved', Math.abs(win[1].start - 4) < 0.01, `got ${win[1].start}`)

  // Partial overlap clips to the window edges.
  const partial = sliceCuesToWindow(cues, 12, 16)
  check('partial-overlap start clipped to window', partial[0].start === 0, `got ${partial[0].start}`)
  check('partial-overlap end clipped to window', partial[partial.length - 1].end <= 4.01, `got ${partial[partial.length - 1].end}`)
}

console.log('buildCaptionChunks — punchy, monotonic, bounded')
{
  const windowCues: TranscriptCue[] = [
    { start: 0, end: 4, text: 'one two three four five six seven eight' }, // 8 words
    { start: 4, end: 6, text: 'nine ten' },
  ]
  const chunks = buildCaptionChunks(windowCues, { maxWords: 4 })
  check('long cue split into ≤4-word chunks', chunks[0].text.split(' ').length <= 4, chunks[0].text)
  check('chunks are monotonic non-overlapping', chunks.every((c, i) => i === 0 || c.startSec >= chunks[i - 1].endSec))
  check('every chunk has positive width', chunks.every(c => c.endSec > c.startSec))

  // maxChunks merges the tail rather than dropping captions off the end.
  const many: TranscriptCue[] = Array.from({ length: 30 }, (_, i) => ({ start: i, end: i + 1, text: `word${i}` }))
  const capped = buildCaptionChunks(many, { maxWords: 1, maxChunks: 10 })
  check('maxChunks respected', capped.length <= 10, `got ${capped.length}`)
  check('tail merge keeps last word', capped[capped.length - 1].text.includes('word29'))
  check('tail merge keeps clip end', Math.abs(capped[capped.length - 1].endSec - 30) < 0.01, `got ${capped[capped.length - 1].endSec}`)
}

console.log('captionsForClip + chunksToSrt — integration')
{
  const cues: TranscriptCue[] = [
    { start: 8, end: 12, text: 'this is the hook line' },
    { start: 12, end: 15, text: 'and the payoff' },
  ]
  const caps = captionsForClip(cues, 8, 15, { maxWords: 3 })
  check('captions produced for the window', caps.length > 0, `got ${caps.length}`)
  check('captions start at clip 0', caps[0].startSec >= 0 && caps[0].startSec < 1, `got ${caps[0].startSec}`)
  const srt = chunksToSrt(caps)
  check('SRT has index + arrow', /^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(srt), srt.slice(0, 40))

  const ts = cuesToTimestampedText(cues)
  check('timestamped text uses [mm:ss]', /^\[00:08\] this is the hook line/.test(ts), ts.slice(0, 30))
}

console.log('extractYouTubeVideoId — link parsing')
{
  const id = 'dQw4w9WgXcQ'
  check('watch?v=', extractYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`) === id)
  check('youtu.be', extractYouTubeVideoId(`https://youtu.be/${id}`) === id)
  check('/shorts/', extractYouTubeVideoId(`https://youtube.com/shorts/${id}`) === id)
  check('/embed/', extractYouTubeVideoId(`https://www.youtube.com/embed/${id}`) === id)
  check('extra params', extractYouTubeVideoId(`https://youtu.be/${id}?t=42&si=abc`) === id)
  check('bare id', extractYouTubeVideoId(id) === id)
  check('garbage → null', extractYouTubeVideoId('https://example.com/not-a-video') === null)
}

if (failures > 0) {
  console.error(`\n✗ ${failures} shorts-caption assertion(s) failed.`)
  process.exit(1)
}
console.log('\n✓ All shorts-caption tests passed.')
