// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A-ROLL AND B-ROLL FROM DRIVE (Seb, 2026-10-30). Pinned: the same name
// pairs first; then filming order (camera number, or the time in the name,
// then when it reached Drive); a B-roll is used once; every talking take is
// listed, with no B-roll when none fits; upright is a TRYBE ad; a name a
// camera wrote is never taken for a product.
import { readFileSync } from 'node:fs'
import { baseName, filmedKey, kindOf, pairTakes, productFromName, unpaired, type DriveTake } from '../lib/review-edit-batch'

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

const U = readFileSync('components/review-editor/DriveBatch.tsx', 'utf8')
const E = readFileSync('components/review-editor/ReviewEditor.tsx', 'utf8')
const P = readFileSync('components/review-editor/drive-picker.ts', 'utf8')
check('the creator sets an A-roll and a B-roll folder once, and MVP remembers them', /Choose your A-roll folder/.test(U) && /Choose your B-roll folder/.test(U) && /action: 'folders'/.test(U))
check('a batch opens the picker in each folder, many files at once', /MULTISELECT_ENABLED/.test(P) && /setParent\(o\.folderId\)/.test(P) && /pickMany\(/.test(U))
check('the batch is on the page once Drive is connected', /\{drive\?\.connected && <DriveBatch /.test(E))
check('each video in a batch gets its own title, not the one typed for a single video', /title: \{ \.\.\.settings\.title, text: '' \}/.test(U))
check('a pair that could not be added says why, and stays to try again', /failed\.push\(`\$\{p\.a\.name\}: /.test(U) && /not added: \$\{added\.failed\.join/.test(U))
check('the pairs are shown to check before anything is queued', /Check the pairs/.test(U) && /Add all \$\{pairs\.length\}/.test(U))

if (fails.length) { console.error(`\n❌ review-edit-batch: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit-batch: A-roll and B-roll paired by name, then filming order, each checked before it is queued')
