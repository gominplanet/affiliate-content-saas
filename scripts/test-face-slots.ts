// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE FACE SLOTS A CREATOR SEES ARE THE ONES THEY PAID FOR, AND DELETING ONE
// DOES WHAT THE WARNING SAYS IT DOES.
//
// Both halves came from one support ticket. A Pro creator asked how to delete a
// face to make room for her husband's, and whether she would then have to go
// back through her blog and YouTube checking that past images had not vanished.
//
// She was wrong about needing to delete anything, and she was wrong about the
// risk, and we had told her both things ourselves.
//
//   THE CAP. app/(dashboard)/photobooth had `const MAX_FACES = 2`, hardcoded
//   for everybody. The API has always enforced TIERS[tier].maxFaces, which is
//   three on Pro. So she saw "2/2" and a disabled Add button while the server
//   would have accepted a third. She was locked out of a slot she pays for by a
//   number typed into a component.
//
//   THE WARNING. The delete confirmation said "any thumbnails/posts that rely
//   on it will lose your likeness". Nothing has a foreign key to face_models,
//   nothing cascades from it, and no component reads it while rendering. A
//   generated thumbnail is a finished image file; the face model is an input to
//   MAKING one. The DELETE route removes the training selfies and the row, and
//   touches no output. The sentence described a consequence that cannot happen,
//   and buried the one that can (future generations lose that face).
//
// A cap that can be typed will be, and a warning about data loss that nobody
// re-reads against the delete code will drift away from it. Both are pinned.
import { readFileSync, readdirSync } from 'node:fs'
import { TIERS } from '../lib/tier'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}
const read = (p: string) => readFileSync(p, 'utf8')
const live = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l)).join('\n')

const PAGE = live(read('app/(dashboard)/photobooth/page.tsx'))
const API = live(read('app/api/face-models/route.ts'))
const DELETE_ROUTE = live(read('app/api/face-models/[id]/route.ts'))

// ── the screen shows the tier's real cap ────────────────────────────────────
{
  check('the page reads the cap from the tier',
    /TIERS\[normalizeTier\(tier\)\]\?\.maxFaces/.test(PAGE),
    'it was hardcoded to 2, which locked Pro out of the third face it sells')
  check('and does not type a number for it',
    !/const MAX_FACES = \d+/.test(PAGE),
    'a cap that can be typed will be, and this one already was')
  check('unlimited is handled rather than rendered as a number',
    /MAX_FACES\) \? MAX_FACES : '∞'/.test(PAGE),
    'null means no cap; "2/null" on screen is worse than the bug it replaced')

  // The two must agree. The server has always been right; the point is that the
  // screen now says the same thing.
  check('the API still enforces the tier cap',
    /const maxFaces = TIERS\[tier\]\.maxFaces/.test(API),
    'if this moves, the page is now the second opinion again')

  // Named so a tier change cannot silently make the UI wrong again.
  for (const t of ['creator', 'amazon', 'studio', 'pro'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (TIERS[t] as any).maxFaces
    check(`${t} has a real face cap to show`, typeof v === 'number' && v > 0, String(v))
  }
  check('Pro sells more faces than the old hardcoded 2',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((TIERS.pro as any).maxFaces ?? 0) > 2,
    'this is the exact gap the creator hit; if Pro ever drops to 2 this clause is just noise and can go')
}

// ── the delete warning matches what delete does ─────────────────────────────
{
  // The description STRING, not a slice of the file around it. A fixed-width
  // slice swept up neighbouring code and failed the dash check on a hyphen that
  // was not in the copy at all.
  const confirmBlock = PAGE.slice(PAGE.indexOf('Delete this face?'))
    .match(/description: '((?:[^'\\]|\\.)*)'/)?.[1] ?? ''
  check('the warning copy was found', confirmBlock.length > 40, `${confirmBlock.length} chars`)

  check('the warning says published work is unaffected',
    /not affected|stay exactly as they are/i.test(confirmBlock),
    'the old wording sent a creator off to audit her blog for images that were never at risk')
  check('and no longer claims past thumbnails lose the likeness',
    !/thumbnails\/posts that rely on it will lose/.test(PAGE),
    'that consequence cannot happen: no cascade, no FK, nothing reads it at render')
  check('the real consequence is still stated',
    /anything NEW/.test(confirmBlock),
    'removing a false warning must not remove the true one with it')
  check('and that the photos have to be re-uploaded',
    /upload them again/i.test(confirmBlock))

  // House style, on a sentence a creator reads in a modal.
  check('no dash punctuation in the warning',
    !/[—–]/.test(confirmBlock) && !/\S \- \S/.test(confirmBlock),
    confirmBlock.slice(0, 120))

  // THE CLAIM IS ONLY TRUE WHILE THIS STAYS TRUE. If the delete route ever
  // starts removing generated output, the reassuring copy above becomes the
  // lie, and that is far worse than the warning it replaced.
  check('DELETE removes only the training images',
    /const paths = \[[\s\S]{0,160}source_images[\s\S]{0,160}optimized_images/.test(DELETE_ROUTE),
    'those two arrays are the uploaded selfies, not anything the product generated')
  check('and nothing else in the delete path touches a generated image',
    !/blog_thumbnail_url|instagram_ai_thumbnail_url|thumbnail_url/.test(DELETE_ROUTE),
    'the copy now promises published work is safe; this is what makes that promise true')
}

// ── nothing in the schema cascades from a face model ────────────────────────
//
// The reassurance above rests on this. A future migration adding
// `face_model_id ... references face_models on delete cascade` would quietly
// make the modal lie, so the absence is asserted rather than assumed.
{
  const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
  const offenders: string[] = []
  for (const f of migs) {
    const sql = read(`supabase/migrations/${f}`).toLowerCase()
    // A reference TO face_models is what would tie other rows to its lifetime.
    if (/references\s+(?:public\.)?face_models/.test(sql)) offenders.push(f)
  }
  check('no table hangs off face_models',
    offenders.length === 0,
    `${offenders.join(', ')} adds a reference; deleting a face would now take rows with it and the modal copy needs rewriting`)
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
