// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A PICTURE ON OUR SERVER RENDERED AS A GREEN TICK FOR FOUR MONTHS.
//
// Measured, not estimated:
//
//   610ad913   81 posts   oldest 26 Jun   newest 16 Sep
//   80822bd4   69 posts   oldest 12 Jul   newest 15 Sep
//   74efb4c7   23 posts   oldest 27 Jun   newest 10 Sep
//   f1d13171    7 posts   oldest  3 Aug   newest  7 Sep
//   9936ec62    4 posts   oldest 28 May   newest  2 Sep
//   d8f53815    2 posts   oldest 30 Jul   newest 11 Sep
//              186 posts, every one of them live on a site
//
// The newest was published the day before this was written, so this is not a
// backlog being cleared, it is a leak still running. All 40 sampled fal URLs
// still answered, so nothing is lost yet, and fal's documentation says expired
// files are deleted and cannot be recovered.
//
// It went unseen because a hot-linked post and a good one looked identical:
// same green "🖼 3", same silence. Three separate places kept it that way, and
// all three are pinned below.
//
//   1. /api/blog/refresh-images wrote images_status 'ready' UNCONDITIONALLY, in
//      both of its paths. The fix had been applied to /api/blog/generate only,
//      so every "Retry images" press overwrote an honest 'hotlinked' with a
//      lie, on the very posts the other route had marked correctly.
//   2. GenerateButton recomputed the status client side as
//      `count > 0 ? 'ready' : 'failed'`, discarding whatever the server said.
//   3. The badge showed a green count whenever the count was above zero,
//      without asking where those pictures actually live.
//
// The rule now lives in one module because two routes cannot hold it in their
// heads. That is the whole lesson of this bug: it was fixed once, in one place,
// and the other place quietly undid it.
import { imagesStatusOf, describeImages } from '../lib/images-status'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const strip = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

// ── the rule itself ───────────────────────────────────────────────────────
{
  check('all of them landed is ready', imagesStatusOf(3, 3) === 'ready')
  check('none of them landed is hot-linked, not failed',
    imagesStatusOf(3, 0) === 'hotlinked', imagesStatusOf(3, 0))
  check('SOME of them landed is still hot-linked',
    imagesStatusOf(3, 2) === 'hotlinked', imagesStatusOf(3, 2))
  check('and one picture short is enough',
    imagesStatusOf(10, 9) === 'hotlinked',
    'a single URL that can be collected leaves a gap in a published article')
  check('no pictures at all is failed', imagesStatusOf(0, 0) === 'failed')

  // Nothing here may round UP to success.
  for (const [t, h] of [[3, 1], [1, 0], [5, 4], [2, 0]] as Array<[number, number]>) {
    check(`${h} of ${t} is never reported as ready`, imagesStatusOf(t, h) !== 'ready')
  }
  check('rubbish does not become a pass',
    imagesStatusOf(NaN, NaN) === 'failed' && imagesStatusOf(3, NaN) === 'hotlinked')
  check('more hosted than made is not an error state',
    imagesStatusOf(2, 3) === 'ready', 'defensive, but it must not read as a problem')
}

// ── what the creator reads ────────────────────────────────────────────────
{
  const none = describeImages('hotlinked', 3, 0, 'jdtheot.com')
  check('a hot-linked post needs attention', none.needsAttention)
  check('and never carries a plain image count as its label',
    !/^\d+ image/.test(none.label), none.label)
  check('it says how many', /None of the 3 pictures/.test(none.detail), none.detail)
  check('it names the site', /jdtheot\.com/.test(none.detail))
  check('it says what it costs', /gap|no copy to put back/i.test(none.detail),
    'without the consequence this reads as a technicality nobody acts on')
  check('and what to do about it', /Test pictures/.test(none.detail))

  const some = describeImages('hotlinked', 5, 3)
  check('a partial says the number that is wrong, not the number that is right',
    /2 of the 5 pictures in this post are not/.test(some.detail), some.detail)

  const unknown = describeImages('hotlinked', 4, null)
  check('an unknown hosted count does not invent one',
    !/\d+ of the/.test(unknown.detail), unknown.detail)
  check('and still says the pictures are not theirs',
    /not on your own site/.test(unknown.detail), unknown.detail)

  const ready = describeImages('ready', 3, 3)
  check('a good post does not need attention', !ready.needsAttention)
  check('and says where they are', /stored on your own site/.test(ready.detail), ready.detail)

  check('pending is not a problem', !describeImages('pending', 0, 0).needsAttention)
  check('skipped is not a problem', !describeImages('skipped', 0, 0).needsAttention)
  check('failed is', describeImages('failed', 0, 0).needsAttention)
  check('a zero count is failed whatever the status claims',
    describeImages('ready', 0, 0).status === 'failed',
    'a row saying ready with nothing in it is the old bug in the other direction')
}

// ── BOTH routes use the shared rule ───────────────────────────────────────
//
// This is the clause that matters. The bug was one route honest and the other
// writing 'ready' regardless, so it is not enough that the rule exists.
{
  const GEN_RAW = readFileSync('app/api/blog/generate/route.ts', 'utf8')
  const REF_RAW = readFileSync('app/api/blog/refresh-images/route.ts', 'utf8')
  const GEN = strip(GEN_RAW)
  const REF = strip(REF_RAW)

  for (const [name, src] of [['generate', GEN], ['refresh-images', REF]] as Array<[string, string]>) {
    check(`${name} imports the shared rule`, /from '@\/lib\/images-status'/.test(src))
    check(`${name} calls it`, /imagesStatusOf\(/.test(src),
      'an import nothing calls is the same as no import')
    check(`${name} tracks whether each picture landed`, /hosted: (true|false|hosted)/.test(src),
      'without a hosted flag the count is identical either way, which is what hid this')
    check(`${name} counts the hosted ones`, /\.filter\(u => u\.hosted\)\.length/.test(src))

    // The literal that caused it. Any unconditional 'ready' write is the bug.
    const unconditional = new RegExp(`images_status: 'ready'`).test(src)
    check(`${name} never writes images_status 'ready' outright`, !unconditional,
      'this exact literal in refresh-images overwrote the honest status on every re-roll')
  }

  check('refresh-images tells the client what it found',
    /hostedCount,/.test(REF) && /imagesStatus,/.test(REF),
    'a status written to the row but not returned leaves the screen guessing')

  // Both write paths in refresh-images, not just the one that was easy to find.
  const readyWrites = (REF.match(/images_status: /g) ?? []).length
  check('every status write in refresh-images is computed', readyWrites >= 2,
    `found ${readyWrites}; the user-photo path and the generated path both write one`)

  check('a missing images_hosted_count does not lose the status too',
    /body_images_count: uploaded\.length, images_status: (userImagesStatus|imagesStatus)/.test(REF),
    'PostgREST rejects the whole statement over one unknown column, so the retry has to drop only that column')
}

// ── AND THE SCREEN SAYS IT ────────────────────────────────────────────────
//
// The row is where this was invisible. A status nothing renders is the silence
// this replaces.
{
  const BTN = strip(readFileSync('components/content/GenerateButton.tsx', 'utf8'))
  const PAGE = strip(readFileSync('app/(dashboard)/content/page.tsx', 'utf8'))

  check('the client no longer decides the status for itself',
    !/imagesStatus: count > 0 \? 'ready' : 'failed'/.test(BTN),
    'this line relabelled every hot-linked run as a success the moment it came back')
  check('it takes what the server earned',
    /typeof j\.imagesStatus === 'string'/.test(BTN))

  check('a hot-linked post does NOT get the green count',
    /result\.imagesStatus !== 'hotlinked'/.test(BTN),
    'the green count is the badge a good post gets; sharing it is exactly how this hid')
  check('it gets its own badge instead', /Not on your site/.test(BTN))
  check('with the full explanation on it', /describeImages\('hotlinked'/.test(BTN))
  check('and the re-roll toast says it too', /on your site\./.test(BTN),
    'the toast is the one thing a creator definitely reads after pressing the button')

  // Anchored to the SELECT, not to the file. The first version of this clause
  // tested for the column name anywhere in the page, which the mapping line
  // below satisfies on its own, so dropping it from the query was invisible.
  check('the Library query asks for the hosted count',
    /select\('id,video_id,[^']*\bimages_hosted_count\b[^']*'\)/.test(PAGE),
    'without it in the query every already-published row falls back to the old green count')
  check('and hands it to the row', /imagesHostedCount: \(p\.images_hosted_count/.test(PAGE))
}

// ── house style ───────────────────────────────────────────────────────────
{
  const lines = [
    describeImages('hotlinked', 3, 0, 'example.com').detail,
    describeImages('hotlinked', 5, 3).detail,
    describeImages('failed', 0, 0).detail,
    describeImages('ready', 2, 2).detail,
    describeImages('pending', 0, 0).detail,
    describeImages('skipped', 0, 0).detail,
  ]
  for (const l of lines) {
    check(`no dash punctuation in "${l.slice(0, 44)}…"`, !/[—–]|\s-\s/.test(l))
    check(`no year in "${l.slice(0, 44)}…"`, !/\b20\d{2}\b/.test(l))
  }
}

if (failures.length) {
  console.error(`\n❌ images-hosted: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ images-hosted: a picture on our server is never reported as a picture on theirs')
