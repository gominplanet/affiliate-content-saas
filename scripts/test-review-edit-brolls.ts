// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEVERAL B-ROLL FILES FOR ONE VIDEO (Seb, 2026-11-04: "we need to be able to
// upload more than one file for b roll.. and let mvp use them all together as
// it sees fit").
//
// Pinned here: the One video form takes several B-roll files from either
// place, each shown with how it is going and taken out on its own; they go
// to MVP as one joined B-roll take; a file that did not come stops the add
// rather than being left out quietly; and MVP knows where each file starts,
// so no shot runs from one file into the next.
import { readFileSync } from 'node:fs'
import { withinClip, framesPerFile } from '../lib/review-edit-plan'
import { brollFilesLine } from '../lib/review-edit-server'
import { MAX_FILES } from '../lib/review-edit-batch'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ── NO SHOT ACROSS TWO FILES ─────────────────────────────────────────────────
check('a shot inside one file is kept as it is', same(withinClip(2, 5, [0, 10, 20], 30), [2, 5]))
check('a shot over a join keeps its longer side', same(withinClip(8, 13, [0, 10, 20], 30), [10, 13]) && same(withinClip(7, 11, [0, 10, 20], 30), [7, 10]))
check('a shot over two joins keeps the longest piece', same(withinClip(9, 21, [0, 10, 20], 30), [10, 20]))
check('one file is never split', same(withinClip(0, 30, [0], 30), [0, 30]))
const P = read('lib/review-edit-plan.ts')
check('the shot reader is told the clips and which clip each frame is from', /starts: number\[\] = \[0\]/.test(P) && /B-roll clips of a product, joined in order/.test(P) && /A shot never runs from one clip into the next\./.test(P) && /, clip \$\{clipOf\(f\.at\) \+ 1\}/.test(P))
check('and every shot is held inside one clip', /\[start, end\] = withinClip\(start, end, starts, duration\)/.test(P))
const S = read('lib/review-edit-server.ts')
// ── EVERY FILE SEEN (Seb, 2026-11-04: "MVP is going to use snippets of each
// in context. Yes?"). Pictures spread over all the files together could miss
// a short clip next to long ones; each file now gets its own share.
check('a short clip next to a long one is still seen', same(framesPerFile([120, 5, 5]), [16, 6, 6]))
check('even files share evenly, about 48 pictures in all', same(framesPerFile([10, 10, 10, 10, 10, 10]), [8, 8, 8, 8, 8, 8]))
check('a file of no length gets none, never a division by nothing', same(framesPerFile([0, 10]), [0, 16]) && same(framesPerFile([0, 0]), [0, 0]))
check('each file is looked at on its own, two at a time, on the joined clock', /const counts = framesPerFile\(lengths\)/.test(S) && /\{ \.\.\.p, frames: counts\[k\], width: 320 \}/.test(S) && /i \+= 2/.test(S) && /starts\[k\] \+ Math\.min\(f\.at/.test(S))
check('one B-roll file is looked at as before', /\{ \.\.\.src\.broll, frames: 36, width: 320 \}/.test(S))
check('each shot knows its file', /\.\.\.\(clips \? \{ clip: clipOf\(start \+ 0\.01\) \} : \{\}\)/.test(P))
check('the planner is told to use good shots from every file, spread through the video', /Use good shots from every clip where they fit what is said, spread through the video, rather than many from one clip\./.test(P) && /, clip \$\{s\.clip \+ 1\}/.test(P))
{
  const shots = [{ n: 1, start: 0, end: 3, what: 'box', clip: 0 }, { n: 2, start: 10, end: 13, what: 'zip', clip: 1 }]
  const plan = { placements: [{ shot: 1, line: 3, why: '' }] }
  check('the card says which files went in, and why any did not',
    brollFilesLine(['a.mov', 'b.mov', 'c.mov'], shots, plan) === ' B-roll from 1 of 3 files. Not used: b.mov (nothing in it fitted what you said), c.mov (no clear shots in it).')
  check('a file MVP could not open says so', /c\.mov \(MVP could not open it\)/.test(brollFilesLine(['a.mov', 'b.mov', 'c.mov'], shots, plan, [2])))
  check('every file used says so, and one file says nothing', brollFilesLine(['a.mov', 'b.mov'], shots, { placements: [{ shot: 1, line: 1, why: '' }, { shot: 2, line: 5, why: '' }] }) === ' B-roll from 2 of 2 files.' && brollFilesLine(['a.mov'], shots, plan) === '')
  check('a moment taken out does not count as used', /b\.mov/.test(brollFilesLine(['a.mov', 'b.mov'], shots, { placements: [{ shot: 1, line: 1, why: '' }, { shot: 2, line: 5, why: '', off: true }] })))
}
check('the reading note and the card both say it', /brollFilesLine\(takeFiles\(row\.broll_src\)/.test(S) && /brollFiles: plan && r\.shots \? brollFilesLine\(/.test(read('app/api/review-edit/route.ts')) && /\{e\.brollFiles && <p/.test(read('components/review-editor/ReviewEditor.tsx')))
check('each B-roll moment on the card names its file', /\{b\.file && <span style=\{soft\}>, from \{b\.file\}<\/span>\}/.test(read('components/review-editor/ReviewEditor.tsx')))

// ── THE ONE VIDEO FORM ───────────────────────────────────────────────────────
const U = read('components/review-editor/ReviewEditor.tsx')
check('up to six B-roll files, the same as a joined take', MAX_FILES === 6 && /import \{ MAX_FILES \} from '@\/lib\/review-edit-batch'/.test(U))
check('several picked at once in Google Drive', /pickVideosFromDrive\(/.test(U) && /open\(o, \[mine, recent\], true,/.test(read('components/review-editor/drive-picker.ts')))
check('several chosen at once on the computer, uploaded one after another', /<input type="file" accept="video\/\*" multiple/.test(U) && /for \(const it of items\) \{/.test(U) && /await uploadTake\(supabase, user\.id, it\.file/.test(U))
check('each file shows how it is going, and is taken out on its own', /waiting its turn to upload/.test(U) && /aria-label=\{`Take \$\{u\.name\} out`\}/.test(U))
check('the same file is never added twice, and the seventh is said, not dropped quietly', /!list\.some\(\(y\) => y\.key === x\.key\)/.test(U) && /One video takes up to \$\{MAX_FILES\} B-roll files/.test(U))
check('the list read across waits is the list right now', /const brollsNow = useRef/.test(U) && /brollsNow\.current\.some\(\(b\) => b\.key === it\.key\)/.test(U))
check('they go to MVP as one take: the first, then the rest in order', /\{ \.\.\.asTake\(rolls\[0\]\), \.\.\.\(rolls\.length > 1 \? \{ more: rolls\.slice\(1\)\.map\(asTake\) \} : \{\}\) \}/.test(U))
check('a file that did not come stops the add and says so', /disabled=\{!ready\(review\) \|\| !!uploading \|\| brollBad \|\| adding\}/.test(U) && /A B-roll file did not come in\. Take it out, or add it again\./.test(U))
check('the form says MVP uses them all', /MVP looks through all \{brolls\.filter\(\(b\) => !b\.error\)\.length\} and puts each shot where you talk about what it shows\./.test(U))
const R = read('app/api/review-edit/route.ts')
check('the add accepts a B-roll of several files, each checked', /const broll = body\.broll \? await src\(body\.broll\) : null/.test(R) && /One video can be joined from up to \$\{MAX_TAKE_FILES\} files\./.test(R))

if (fails.length) {
  console.error(`\n❌ review-edit-brolls: ${fails.length} failure(s)\n`)
  for (const f of fails) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ review-edit-brolls: several B-roll files for one video, from Drive or the computer, joined, each shot kept inside its own file')
