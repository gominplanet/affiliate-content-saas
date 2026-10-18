// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Guard: "your own thumbnail text" (Seb, 2026-10-18) is offered wherever MVP
// makes a thumbnail, and the words a creator types are the words on the image.
//
// The failure this exists for already happened once in this codebase: the art
// director was told "use these exact words", and its two lines then went
// through the clamps and scrubs written for its OWN copy. A long line lost its
// last word, a pair that read as a health claim became "WHAT YOU ACTUALLY
// GET", and the screen said nothing. Both look like success. So this pins the
// rules (lib/thumb-text), the generator using them after the briefs come back,
// and every surface sending the text.
import { readFileSync } from 'node:fs'
import { normalizeThumbText, splitThumbText, thumbTextProblem, withOwnThumbText } from '../lib/thumb-text'

const failures: string[] = []
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name}${detail ? `: ${detail}` : ''}`); failures.push(name) }
}
const read = (p: string) => readFileSync(p, 'utf8')

// ── the rules ───────────────────────────────────────────────────────────────
{
  check('text is upper-cased with single spaces', normalizeThumbText('  worth   the hype? ') === 'WORTH THE HYPE?')
  const two = splitThumbText('worth the hype?')
  check('it splits into two lines without breaking a word',
    !!two && `${two.line1} ${two.line2}` === 'WORTH THE HYPE?', JSON.stringify(two))
  check('and the main line is never the shorter one',
    !!two && two.line2.length >= two.line1.length, JSON.stringify(two))
  const one = splitThumbText('WOW')
  check('one word is the main line alone', !!one && one.line1 === '' && one.line2 === 'WOW', JSON.stringify(one))
  const six = 'IS THIS THE BEST ONE YET?'
  const s6 = splitThumbText(six)
  check('every word survives the split', !!s6 && `${s6.line1} ${s6.line2}`.trim() === six, JSON.stringify(s6))
  check('empty text is fine (MVP writes its own)', thumbTextProblem('') === null && thumbTextProblem('   ') === null)
  check('a normal line passes', thumbTextProblem('Does it actually work?') === null)
  check('too many words is refused with the reason', /6 words/.test(thumbTextProblem('one two three four five six seven') || ''))
  check('Amazon and Prime are refused, and the reason names them',
    /Amazon/.test(thumbTextProblem('best amazon find') || '') && /Prime/.test(thumbTextProblem('prime day steal') || ''))
  check('a health claim is refused rather than swapped', /health claim/.test(thumbTextProblem('boosts your energy') || ''))
  check('the word honest is refused', /honest/.test(thumbTextProblem('my honest take') || ''))
  check('a word too long for a line is refused', !!thumbTextProblem('SUPERCALIFRAGILISTICEXPIALIDOCIOUS'))
  const briefs = withOwnThumbText([{ line1: 'MVP', line2: 'WROTE THIS', emphasisWord: 'WROTE' }, { line1: 'A', line2: 'B', emphasisWord: 'HYPE' }], 'worth the hype?')
  check('every brief carries the creator\'s words', briefs.every((b) => `${b.line1} ${b.line2}` === 'WORTH THE HYPE?'))
  check('the accent word is kept only when it is one of theirs',
    briefs[0].emphasisWord === '' && withOwnThumbText([{ line1: 'X', line2: 'Y', emphasisWord: 'hype?' }], 'worth the hype?')[0].emphasisWord === 'HYPE?')
  const none = [{ line1: 'MVP', line2: 'WROTE THIS' }]
  check('no own text leaves the briefs alone', withOwnThumbText(none, '')[0] === none[0])
}

// ── the generator uses them ─────────────────────────────────────────────────
{
  const R = read('app/api/youtube/generate-thumbnail/route.ts')
  check('the route refuses a text it cannot use, before spending',
    /const why = thumbTextProblem\(lockedHeadline\)[\s\S]{0,120}status: 400/.test(R)
      && R.indexOf('thumbTextProblem(lockedHeadline)') < R.indexOf('claimsSheetPromise'))
  const wraps = (R.match(/withOwnThumbText\(await getOrCreateBriefs\(/g) || []).length
  check('both design paths put the creator\'s words on after the briefs', wraps === 2, `${wraps} of 2`)
  check('and the response says when it was their text', (R.match(/ownText: lockedHeadline \|\| null/g) || []).length === 2)
  check('a one-word text gets no empty top line',
    /line1 \? `  Top line:/.test(R) && /\[line1, line2\]\.filter\(Boolean\)\.join\(' '\)/.test(R)
      && /\[input\.line1, input\.line2\]\.filter\(Boolean\)\.join\(' '\)/.test(read('lib/thumbnail-prompt.ts')))
}

// ── every surface offers it and sends it ────────────────────────────────────
{
  const surfaces: Array<[string, string, RegExp]> = [
    ['Co-Pilot', 'app/(dashboard)/co-pilot/page.tsx', /<ThumbTextInput value=\{customHeadline\}/],
    ['Video Launchpad', 'app/(dashboard)/launchpad/page.tsx', /showOwnText/],
    ['Amazon thumbnails', 'app/(dashboard)/amazon/thumbnails/page.tsx', /<ThumbTextInput value=\{headline\}/],
    ['the post composer', 'components/amazon/PostComposer.tsx', /<ThumbTextInput value=\{ownText\}/],
    ['the Pinterest composer', 'components/amazon/PinterestComposer.tsx', /<ThumbTextInput value=\{ownText\}/],
    ['Post to all', 'components/amazon/PostToAll.tsx', /<ThumbTextInput value=\{ownText\}/],
    ['each video in Bulk upload and Drop', 'components/launch/LaunchBoard.tsx', /<ThumbTextInput compact value=\{thumbText\}/],
  ]
  for (const [name, file, re] of surfaces) check(`${name} offers your own text`, re.test(read(file)))
  check('the shared panel sends it as the headline',
    /customHeadline: normalizeThumbText\(ownText\) \|\| undefined/.test(read('components/thumbnails/ThumbnailBoostPanel.tsx')))
  check('but the batch look never shows it (one line on every video is not a look)',
    !/showOwnText/.test(read('components/launch/ThumbnailPicker.tsx')))
  for (const f of ['components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx', 'components/amazon/PostToAll.tsx']) {
    check(`${f.split('/').pop()} sends it`, /customHeadline: normalizeThumbText\(ownText\)/.test(read(f)))
  }
  const ITEM = read('app/api/launch/items/[id]/route.ts')
  check('a video\'s own text is checked with the same rules before it is saved',
    /'thumbnailText' in body[\s\S]{0,900}thumbTextProblem\(text\)/.test(ITEM))
  check('and new words build its thumbnails again, like a new face',
    /thumbnail_text: text,[\s\S]{0,200}thumbnail_url: null/.test(ITEM))
  const DRAIN = read('app/api/cron/launch-drain/route.ts')
  check('the background builder sends each video\'s own words',
    /styledThumbnail\(it\.user_id, title, asin, preset, ownText\)/.test(DRAIN) && /customHeadline: ownText/.test(DRAIN))
  check('and a fallback thumbnail says it does not carry them',
    /It does not have your text/.test(DRAIN))
  check('the migration is safe to run twice',
    /add column if not exists thumbnail_text text/.test(read('supabase/migrations/440_launch_item_thumb_text.sql')))
}

if (failures.length) {
  console.error(`\n❌ thumb-text: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('✅ thumb-text: your own words, everywhere a thumbnail is made, and exactly as typed')
