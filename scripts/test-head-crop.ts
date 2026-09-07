// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Where to cut a selfie so the creator's own shirt stops reaching the renderer.
//
// This geometry runs on the identity reference, which is the one image the
// whole thumbnail is built from. Two ways to get it wrong, and they fail in
// opposite directions:
//
//   cut too low  → the collar survives, the render copies the creator's own
//                  plain polo instead of the product, and we are back to the
//                  bug this exists to fix
//   cut too high → the chin comes off, the identity lock goes with it, and the
//                  thumbnail is of somebody else
//
// So every case here is a real photo shape: a tight headshot, a head-and-chest
// selfie, a half-body shot, a face near an edge, a face too small to use.
import {
  parseFaceBox, headCropRect, headCropNote, FACE_BOX_PROMPT,
  type FaceBox,
} from '../lib/head-crop'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── reading the answer ──────────────────────────────────────────────────────
{
  const ok = parseFaceBox('{"face":{"x":0.3,"y":0.1,"w":0.35,"h":0.28}}')
  check('a clean answer parses', !!ok && ok.x === 0.3 && ok.h === 0.28)

  check('a preamble does not break it',
    parseFaceBox('Here is the bounding box:\n{"face":{"x":0.3,"y":0.1,"w":0.35,"h":0.28}}')?.w === 0.35)
  check('a markdown fence does not break it',
    parseFaceBox('```json\n{"face":{"x":0.3,"y":0.1,"w":0.35,"h":0.28}}\n```')?.w === 0.35)
  check('a nested object does not truncate the scan',
    parseFaceBox('{"meta":{"n":1},"face":{"x":0.3,"y":0.1,"w":0.35,"h":0.28}}')?.w === 0.35)
  check('numbers as strings still count',
    parseFaceBox('{"face":{"x":"0.3","y":"0.1","w":"0.35","h":"0.28"}}')?.w === 0.35)
}

// ── anything doubtful means "do not crop" ───────────────────────────────────
// Null here keeps the original photo, which risks the creator's shirt. A wrong
// box crops the middle of a forehead and feeds THAT in as the identity
// reference. The second failure is worse and far harder to notice afterwards.
{
  check('no face is null', parseFaceBox('{"face":null}') === null)
  check('empty is null', parseFaceBox('') === null)
  check('null input is null', parseFaceBox(null) === null)
  check('undefined input is null', parseFaceBox(undefined) === null)
  check('prose with no JSON is null', parseFaceBox('I can see a man in a blue polo shirt.') === null)
  check('broken JSON is null', parseFaceBox('{"face":{"x":0.3,"y":') === null)
  check('a missing field is null', parseFaceBox('{"face":{"x":0.3,"y":0.1,"w":0.35}}') === null)
  check('a face bigger than the frame is null', parseFaceBox('{"face":{"x":0,"y":0,"w":1.4,"h":0.5}}') === null)
  check('a box running off the edge is null', parseFaceBox('{"face":{"x":0.8,"y":0.1,"w":0.4,"h":0.3}}') === null)
  check('a speck is null', parseFaceBox('{"face":{"x":0.5,"y":0.5,"w":0.01,"h":0.01}}') === null)
  check('NaN is null', parseFaceBox('{"face":{"x":"abc","y":0.1,"w":0.35,"h":0.28}}') === null)
}

// ── the crop itself, on real photo shapes ───────────────────────────────────
function box(x: number, y: number, w: number, h: number): FaceBox { return { x, y, w, h } }

{
  // A head-and-chest selfie, 1024². This is the shape that produced the bug:
  // the polo is in the bottom half of the frame.
  const r = headCropRect(box(0.32, 0.12, 0.34, 0.26), 1024, 1024)
  check('a head-and-chest selfie crops', !!r)
  if (r) {
    check('the crop keeps the whole face',
      r.top <= 0.12 * 1024 && r.top + r.height >= (0.12 + 0.26) * 1024,
      `top=${r.top} bottom=${r.top + r.height} face=123..389`)
    check('and cuts well above where a collar sits',
      r.top + r.height < 1024 * 0.55, `bottom=${r.top + r.height}`)
  }
}

{
  // A half-body shot: small face, high in a tall frame. The garment is most of
  // the picture, so this is the case where cropping matters most.
  const r = headCropRect(box(0.42, 0.08, 0.16, 0.13), 900, 1600)
  check('a half-body shot crops', !!r)
  if (r) {
    check('the chin survives', r.top + r.height >= (0.08 + 0.13) * 1600)
    check('and the torso is gone', r.top + r.height < 1600 * 0.30, `bottom=${r.top + r.height}`)
  }
}

{
  // A tight headshot that is already head-and-shoulders. Nothing much to remove.
  const r = headCropRect(box(0.18, 0.10, 0.64, 0.62), 800, 800)
  check('a tight headshot still returns a rect', !!r)
  check('and it still trims the bottom of the frame',
    !!r && r.top + r.height < 800, JSON.stringify(r))
}

// ── edges, where an unclamped rectangle throws ──────────────────────────────
{
  const top = headCropRect(box(0.35, 0.0, 0.3, 0.25), 1024, 1024)
  check('a face at the very top clamps to 0', !!top && top.top === 0, JSON.stringify(top))

  const low = headCropRect(box(0.35, 0.68, 0.3, 0.30), 1024, 1024)
  check('a face at the bottom stays inside the image',
    !!low && low.top + low.height <= 1024, JSON.stringify(low))

  const wide = headCropRect(box(0.02, 0.2, 0.3, 0.3), 1024, 1024)
  check('a face at the left edge clamps to 0', !!wide && wide.left === 0)

  for (const r of [top, low, wide]) {
    check('every rect is inside the image',
      !!r && r.left >= 0 && r.top >= 0 && r.left + r.width <= 1024 && r.top + r.height <= 1024,
      JSON.stringify(r))
    check('every rect has positive size', !!r && r.width > 0 && r.height > 0)
  }
}

// ── refusing to produce a useless reference ─────────────────────────────────
{
  check('no face means no crop', headCropRect(null, 1024, 1024) === null)
  check('a zero-size image means no crop', headCropRect(box(0.3, 0.1, 0.3, 0.3), 0, 0) === null)
  check('a face too small to be a reference means no crop',
    headCropRect(box(0.48, 0.30, 0.03, 0.03), 320, 320) === null,
    'a 20px face fed in as the identity lock is worse than the uncropped photo')
}

// ── what the card is told ───────────────────────────────────────────────────
// The one case that must never be silent: no face box, no crop, so the
// creator's own shirt is still the most authoritative clothing in the brief.
{
  check('a total failure says so in plain words',
    /may appear instead of the product/.test(headCropNote(0, 2) || ''), headCropNote(0, 2) || 'null')
  check('a partial crop is counted honestly', headCropNote(1, 2) === '1 of 2 reference photos cropped to head and neck')
  check('a full crop reads simply', headCropNote(2, 2) === 'reference photos cropped to head and neck')
  check('no references means no note at all', headCropNote(0, 0) === null)
}

// ── the question asks for a rectangle, not an opinion ───────────────────────
{
  const p = FACE_BOX_PROMPT
  check('it asks for JSON only', /ONLY JSON/.test(p))
  check('it defines the box as fractions', /fraction of the image/.test(p))
  check('it excludes the neck and shoulders', /neck/.test(p) && /shoulders/.test(p),
    'a box that includes the neck pushes the crop down onto the collar')
  check('it allows no face', /"face":null/.test(p))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
