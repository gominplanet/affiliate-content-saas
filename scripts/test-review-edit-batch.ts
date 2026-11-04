// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A-ROLL AND B-ROLL FROM DRIVE (Seb, 2026-10-30). Pinned: the same name
// pairs first; then filming order (camera number, or the time in the name,
// then when it reached Drive); a B-roll is used once; every talking take is
// listed, with no B-roll when none fits; upright is a TRYBE ad; a name a
// camera wrote is never taken for a product.
//
// ONE VIDEO, SEVERAL FILES (Seb, 2026-11-02: "these files are for video
// #1"). Pinned: takes filmed back to back are guessed to be one video, and
// only those; the creator moves any file to any video, a new one, or out;
// files play in filming order; a join MVP guessed says so and can be undone;
// every file of a video is sent, in order, and checked by the server.
import { readFileSync } from 'node:fs'
import { baseName, filmedKey, kindOf, pairTakes, productFromName, unpaired, backToBack, batchVideos, moveFile, moveUp, filmingOrder, unusedBroll, talkSeconds, addBody, JOIN_GAP_SEC, MAX_FILES, type DriveTake } from '../lib/review-edit-batch'
import { mixedShapes, takeFiles, hasUpload, type Src } from '../lib/review-edit-server'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const take = (id: string, name: string, o: Partial<DriveTake> = {}): DriveTake => ({ id, name, bytes: null, width: 1920, height: 1080, seconds: 120, createdAt: null, ...o })

check('a name a camera wrote says nothing about the product', baseName('IMG_1234.MOV') === '' && baseName('PXL_20261030_142233.mp4') === '' && productFromName('MVI_0042.MP4') === '')
check('a name a person wrote is the product, without A-roll or B-roll words', baseName('Bassdash Hoodie B-roll.mov') === 'bassdash hoodie' && baseName('bassdash hoodie (A roll).mp4') === 'bassdash hoodie' && productFromName('bassdash hoodie talk.mp4') === 'Bassdash Hoodie')
check('filming order from the camera number or the time in the name', filmedKey('IMG_1234.MOV') === 1234 && filmedKey('PXL_20261030_142233123.mp4') === 20261030142233 && filmedKey('Hoodie.mov') === null)
check('upright is a TRYBE ad, sideways a review', kindOf(take('a', 'x', { width: 1080, height: 1920 })) === 'trybe' && kindOf(take('b', 'x')) === 'review' && kindOf(take('c', 'x', { width: null, height: null })) === 'review')

// Named the same in both folders.
const named = pairTakes([take('a1', 'Hoodie.mov'), take('a2', 'Waders talk.mov')], [take('b1', 'Waders broll.mov'), take('b2', 'Hoodie B-roll.mov')])
check('the same name pairs, whatever the order picked', named[0].b?.id === 'b2' && named[1].b?.id === 'b1' && named.every((p) => p.how === 'name'))

// A phone's numbers: talk, B-roll, talk, B-roll, B-roll, talk (no B-roll).
const a = [take('a1', 'IMG_1001.MOV'), take('a2', 'IMG_1003.MOV'), take('a3', 'IMG_1006.MOV', { width: 1080, height: 1920 })]
const b = [take('b2', 'IMG_1004.MOV'), take('b1', 'IMG_1002.MOV'), take('b3', 'IMG_1005.MOV')]
const ordered = pairTakes(a, b)
check('each talking take gets the B-roll filmed after it and before the next', ordered[0].b?.id === 'b1' && ordered[1].b?.id === 'b2' && ordered.every((p) => p.how !== 'name'), ordered.map((p) => p.b?.id))
check('a talking take with no B-roll after it has none, and is still listed', ordered[2].b === null && ordered[2].how === 'none' && ordered.length === 3)
check('a B-roll is used once; the extra one is said to be left over', new Set(ordered.map((p) => p.b?.id).filter(Boolean)).size === 2 && unpaired(ordered, b).map((x) => x.id).join() === 'b3')
check('the upright one is a TRYBE ad', ordered[2].kind === 'trybe' && ordered[0].kind === 'review')

// When it reached Drive, when the names say nothing.
const t = (h: number) => `2026-10-30T${String(h).padStart(2, '0')}:00:00Z`
const byTime = pairTakes([take('a1', 'Review one.mov', { createdAt: t(9) }), take('a2', 'Review two.mov', { createdAt: t(11) })], [take('b2', 'Shots.mov', { createdAt: t(12) }), take('b1', 'More shots.mov', { createdAt: t(10) })])
check('then by when each reached Drive', byTime[0].b?.id === 'b1' && byTime[1].b?.id === 'b2', byTime.map((p) => p.b?.id))
check('nothing to go by and the counts differ: no guessing', pairTakes([take('a1', 'One.mov'), take('a2', 'Two.mov')], [take('b1', 'Shots.mov')]).every((p) => p.b === null))

// When each was filmed, read from the file: names and upload order say nothing.
// Seb's 20 and 20: a phone's talk and B-roll for each product, uploaded at once.
const f = (m: number) => new Date(Date.UTC(2026, 9, 30, 14, m)).toISOString()
const up = '2026-10-30T20:00:00Z'
const As = Array.from({ length: 20 }, (_, i) => take(`a${i}`, `Copy of video ${(i * 7) % 20}.mov`, { filmedAt: f(i * 3), createdAt: up }))
const Bs = Array.from({ length: 20 }, (_, i) => take(`b${i}`, `Shots ${(i * 11) % 20}.mov`, { filmedAt: f(i * 3 + 1), createdAt: up })).reverse()
const twenty = pairTakes(As, Bs)
check('20 talking takes and 20 B-roll, uploaded together and named anything, pair by when they were filmed', twenty.length === 20 && twenty.every((p, i) => p.b?.id === `b${i}` && p.how === 'filmed'), twenty.map((p) => p.b?.id))
const first = pairTakes([take('a1', 'x.mov', { filmedAt: f(2) }), take('a2', 'y.mov', { filmedAt: f(6) })], [take('b1', 'p.mov', { filmedAt: f(1) }), take('b2', 'q.mov', { filmedAt: f(5) })])
check('B-roll filmed before its talk pairs too, when that is how the creator films', first[0].b?.id === 'b1' && first[1].b?.id === 'b2', first.map((p) => p.b?.id))
const mixed = pairTakes([take('a1', 'IMG_2001.MOV'), take('a2', 'talk.mov', { filmedAt: f(10) })], [take('b1', 'IMG_2002.MOV'), take('b2', 'shots.mov', { filmedAt: f(12) })])
check('a filming time is only compared with a filming time, a camera number with a camera number', mixed[0].b?.id === 'b1' && mixed[0].how === 'order' && mixed[1].b?.id === 'b2' && mixed[1].how === 'filmed', mixed.map((p) => [p.b?.id, p.how]))

const U = readFileSync('components/review-editor/DriveBatch.tsx', 'utf8')
// The list to check the videos, shared with a batch from the computer.
const C = readFileSync('components/review-editor/BatchCheck.tsx', 'utf8')
const E = readFileSync('components/review-editor/ReviewEditor.tsx', 'utf8')
const P = readFileSync('components/review-editor/drive-picker.ts', 'utf8')
check('the creator sets an A-roll and a B-roll folder once, and MVP remembers them', /Choose your A-roll folder/.test(U) && /Choose your B-roll folder/.test(U) && /action: 'folders'/.test(U))
check('a batch opens the picker in each folder, many files at once', /MULTISELECT_ENABLED/.test(P) && /setParent\(o\.folderId\)/.test(P) && /pickMany\(/.test(U))
check('the batch is on the page once Drive is connected', /\{drive\?\.connected && <DriveBatch /.test(E))
check('every video in a batch gets the saved look: a typed title (a disclosure) on all, an empty one written for each', /const look = cleanSettings\(\{ \.\.\.settings, kind: v\.kind \}, settings\)/.test(U) && !/text: ''/.test(U))
check('a video that could not be added says why, names its files, and stays to try again', /const label = `Video \$\{i \+ 1\} \(\$\{v\.a\.map\(\(f\) => f\.name\)\.join\(' \+ '\)\}\)`/.test(U) && /why: `\$\{label\}: /.test(U) && /not added: \$\{added\.failed\.join/.test(U) && /videos\.filter\(\(v\) => failed\.some\(\(f\) => f\.id === v\.a\[0\]\.id\)\)/.test(U))
const D = readFileSync('app/api/review-edit/drive/route.ts', 'utf8')
check('takes already made or in the queue are left out and listed, so selecting a whole folder each time is safe', /in\('review_src->>fileId', ids2\)/.test(D) && /in\('broll_src->>fileId', ids2\)/.test(D) && /filter\(\(f\) => !used\.has\(f\.id\)\)/.test(U) && /Left out, already made or in the queue/.test(U))
check('when the filming times could not be read, the page says the pairs need checking', /filmedRead: filmed\.read/.test(D) && /MVP could not read when these were filmed/.test(U))
check('the videos are shown to check before anything is queued', /<BatchCheck videos=\{videos\}/.test(U) && /Check your videos/.test(C) && /Add all \$\{videos\.length\}/.test(U))

// ── One video, several files ─────────────────────────────────────────────────
const at = (iso: string, o: Partial<DriveTake> = {}) => ({ filmedAt: iso, ...o })
// Seb's two files: IMG_0097 (2:10), then IMG_0098 started 14 seconds after it stopped.
const s97 = take('97', 'IMG_0097.MOV', at('2026-11-02T15:00:00Z', { seconds: 130 }))
const s98 = take('98', 'IMG_0098.MOV', at('2026-11-02T15:02:24Z', { seconds: 118 }))
const later = take('99', 'IMG_0101.MOV', at('2026-11-02T15:20:00Z', { seconds: 90 }))
const seb = backToBack([s98, s97, later], [])
check('two talking takes filmed back to back are guessed to be one video, in filming order', seb.length === 2 && seb[0].files.map((f) => f.id).join() === '97,98' && seb[0].apart === 14 && seb[1].files.length === 1, seb.map((c) => [c.files.map((f) => f.id), c.apart]))
check('a take filmed long after is its own video', seb[1].files[0].id === '99' && seb[1].apart === null)
const between = backToBack([s97, s98], [take('b', 'IMG_0098b.MOV', at('2026-11-02T15:02:15Z', { seconds: 5 }))])
check('B-roll filmed between two talking takes means two videos', between.length === 2)
const gap = take('98', 'IMG_0098.MOV', at(new Date(Date.parse('2026-11-02T15:02:10Z') + (JOIN_GAP_SEC + 5) * 1000).toISOString(), { seconds: 118 }))
check(`more than ${JOIN_GAP_SEC} seconds between them means two videos`, backToBack([s97, gap], []).length === 2)
check('an upright take and a sideways one are never guessed to be one video', backToBack([s97, take('98', 'IMG_0098.MOV', at('2026-11-02T15:02:24Z', { width: 1080, height: 1920 }))], []).length === 2)
check('takes named for two products are never guessed to be one', backToBack([take('h', 'Hoodie.mov', at('2026-11-02T15:00:00Z', { seconds: 60 })), take('w', 'Waders.mov', at('2026-11-02T15:01:05Z', { seconds: 60 }))], []).length === 2)
check('without a filming time read from the files, nothing is guessed', backToBack([take('1', 'IMG_0097.MOV'), take('2', 'IMG_0098.MOV')], []).length === 2)

const vids = batchVideos([s97, s98, later], [take('br', 'IMG_0100.MOV', at('2026-11-02T15:10:00Z', { seconds: 40 }))])
check('a joined video gets the B-roll filmed after its last file', vids.length === 2 && vids[0].b[0]?.id === 'br' && vids[0].how === 'filmed' && vids[1].b.length === 0, vids.map((v) => [v.a.map((f) => f.id), v.b.map((f) => f.id)]))
check('its length is both files together', talkSeconds(vids[0]) === 248 && talkSeconds({ ...vids[0], a: [take('x', 'x', { seconds: null })] }) === null)

// The creator says which video each file is for.
const two = batchVideos([take('1', 'IMG_0097.MOV'), take('2', 'IMG_0098.MOV'), take('3', 'IMG_0103.MOV')], [take('r1', 'Hoodie broll.mov'), take('r2', 'More broll.mov')])
const joined = moveFile(two, '2', 0)
check('a talking file moved to video 1 joins it, and its own video is gone', joined.length === 2 && joined[0].a.map((f) => f.id).join() === '1,2' && joined[1].a[0].id === '3' && joined[0].apart === null)
const out = moveFile(joined, '2', 'new')
check('it can go back to a video of its own, straight after the one it left', out.length === 3 && out[1].a[0].id === '2' && out[0].a.map((f) => f.id).join() === '1' && out[2].a[0].id === '3')
const reorder = moveFile(moveFile(two, '1', 1), '3', 0)
check('files land in filming order, by name when no filming time is known', reorder.length === 1 && reorder[0].a.map((f) => f.id).join() === '1,2,3', reorder.map((v) => v.a.map((f) => f.id)))
check('the creator can still play one earlier', moveUp(reorder, '3')[0].a.map((f) => f.id).join() === '1,3,2' && moveUp(reorder, '1')[0].a.map((f) => f.id).join() === '1,2,3')
check('filming order wins over the name when it is known', filmingOrder([s98, s97]).map((f) => f.id).join() === '97,98' && filmingOrder([take('b', 'IMG_10.MOV'), take('a', 'IMG_9.MOV')]).map((f) => f.id).join() === 'a,b')
const pool = [take('r1', 'Hoodie broll.mov'), take('r2', 'More broll.mov')]
const rolls = moveFile(moveFile(two, 'r1', 0, pool), 'r2', 0, pool)
check('a video can take several B-roll files, picked by the creator', rolls[0].b.map((f) => f.id).sort().join() === 'r1,r2' && rolls[0].how === 'you' && unusedBroll(rolls, pool).length === 0)
const dropped = moveFile(rolls, 'r1', 'none', pool)
check('a B-roll file can be left out, and is listed as not used', dropped[0].b.map((f) => f.id).join() === 'r2' && unusedBroll(dropped, pool).map((f) => f.id).join() === 'r1')
check('a talking file is never left out by a move, and B-roll never becomes a video', moveFile(two, '1', 'none') === two && moveFile(two, 'r1', 'new', pool) === two)
const emptied = moveFile(rolls, '1', 1)
check('a video left without a talking file is gone, and its B-roll is not used', emptied.length === 2 && emptied[0].a.map((f) => f.id).join() === '1,2' && unusedBroll(emptied, pool).length === 2, emptied.map((v) => [v.a.map((f) => f.id), v.b.map((f) => f.id)]))
const full = Array.from({ length: MAX_FILES }, (_, i) => take(`f${i}`, `IMG_${1000 + i}.MOV`))
const big = moveFile(full.slice(1).reduce((acc, f) => moveFile(acc, f.id, 0), batchVideos([...full, take('extra', 'IMG_2000.MOV')], [])), 'extra', 0)
check(`a video takes up to ${MAX_FILES} files`, big[0].a.length === MAX_FILES && big.length === 2)
const body = addBody(moveFile(rolls, '2', 0)[0])
check('every file of a video is sent, the first then the rest in order', body.review.driveId === '1' && body.review.more?.map((f) => f.driveId).join() === '2' && body.broll?.more?.length === 1 && addBody(out[1]).review.more === undefined && addBody(out[1]).broll === undefined)

// The server's side: every file kept and cleaned up, shapes checked.
const src: Src = { kind: 'drive', fileId: 'a', name: 'IMG_0097.MOV', more: [{ kind: 'upload', url: 'https://x/u.mp4', path: 'u/u.mp4', name: 'IMG_0098.MOV' }] }
check('a take lists all its files in order', takeFiles(src).map((f) => f.name).join() === 'IMG_0097.MOV,IMG_0098.MOV' && takeFiles(null).length === 0)
check('an uploaded file joined after a Drive one is still deleted when done', hasUpload({ review_src: src, broll_src: null }))
check('one upright file and one sideways cannot be one video, and the message names them', /IMG_0097\.MOV was filmed sideways and IMG_0098\.MOV upright/.test(mixedShapes(takeFiles(src), [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) || '') && mixedShapes(takeFiles(src), [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }]) === null)

const S = readFileSync('lib/review-edit-server.ts', 'utf8')
const R = readFileSync('app/api/review-edit/route.ts', 'utf8')
check('the video server is sent every file, and an older one that cannot join them is waited for, never read from one file', /\.\.\.\(joined\(src\.review\) \? \{ mainParts: src\.review\.parts \}/.test(S) && /brollParts: broll\.parts/.test(S) && /if \(many && !Array\.isArray\(probe\.data\.parts\)\) return await fail\(updating\)/.test(S) && /all\.length === 1 \? all\[0\] : \{ parts: all \}/.test(S))
check('reading refuses a file with no sound, by name', /has no sound, so MVP cannot hear what to cut\. Take it out of this video/.test(S))
check('adding checks every file, names the one that fails, and never takes the same file twice', /for \(const r of rest\)/.test(R) && /return \{ error: `\$\{name\}: \$\{f\.error\}` \}/.test(R) && /The same file is in this video twice/.test(R) && /MAX_TAKE_FILES/.test(R))
check('files joined into a video count as already made in the next batch', /not\('review_src->more', 'is', null\)/.test(D) && /not\('broll_src->more', 'is', null\)/.test(D) && /takeFiles\(s\)/.test(D))
check('the batch shows each file’s video, says when MVP joined them, and undoes it in filming order', /v\.a\.slice\(1\)\.reverse\(\)\.reduce/.test(C) && /aria-label=\{`Which video \$\{f\.name\} is for`\}/.test(C) && /A new video/.test(C) && /Not used/.test(C) && /MVP put these together: they were filmed/.test(C) && /Keep them apart/.test(C) && /\.\.\.addBody\(v\)/.test(U))
check('a video mixing upright and sideways files is stopped before it is added', /disabled=\{!!busy \|\| blocked > 0\}/.test(U) && /filter\(mixed\)/.test(U) && /cannot be one video\. Move one to another video/.test(C))
check('a finished video names the files it was joined from', /joined into one\./.test(E) && /files: \{ talk: takeFiles\(r\.review_src\)/.test(R))

if (fails.length) { console.error(`\n❌ review-edit-batch: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit-batch: A-roll and B-roll paired by name, then filming order, each checked before it is queued')
