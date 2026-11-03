// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR, READY FOR MEMBERS (Seb, 2026-11-03: "go with 100 and 25
// for free week"). Pinned: the video server takes turns between members, so
// one member's batch never goes before everyone else; at most three reads at
// once; each member's waiting video says where it stands; 100 edited videos a
// month, 25 in the first week, counted once per video (Try again and Make it
// again never count twice), the transcription's cost counted every time; a
// batch never adds more than is left, and says why.
import { readFileSync } from 'node:fs'
import { fairOrder, lastServedBy, placesInLine } from '../lib/review-edit-queue'
import { REVIEW_EDITS_MONTHLY_CAP, reviewEditCapFor, PRIMARY_FEATURE } from '../lib/usage-cap'
import { introCap } from '../lib/intro-allowance'
import { allowanceFullWords } from '../lib/review-edit-server'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const at = (min: number) => new Date(Date.UTC(2026, 10, 3, 12, min)).toISOString()

// ── Turns between members ────────────────────────────────────────────────────
// A added twenty at 12:00; B one video at 12:30; C one at 12:31.
const batch = Array.from({ length: 20 }, (_, i) => ({ id: `a${i + 1}`, user_id: 'A', at: at(i) }))
const rows = [...batch, { id: 'b1', user_id: 'B', at: at(30) }, { id: 'c1', user_id: 'C', at: at(31) }]
const order = fairOrder(rows)
check('a batch does not go before everyone else: one of theirs, then one of each other member’s', order.slice(0, 4).join() === 'a1,b1,c1,a2', order.slice(0, 6))
check('every video is in the line once', order.length === rows.length && new Set(order).size === rows.length)
check('a member’s own videos keep their order', order.filter((x) => x.startsWith('a')).join() === batch.map((b) => b.id).join())
const servedA = fairOrder(rows, { A: Date.parse(at(50)), C: Date.parse(at(5)) })
check('the member served longest ago goes first, a member never served before anyone', servedA.slice(0, 3).join() === 'b1,c1,a1', servedA.slice(0, 3))
check('when each was last served is the latest time given', JSON.stringify(lastServedBy([{ user_id: 'A', at: at(1) }, { user_id: 'A', at: at(9) }, { user_id: 'B', at: null }])) === JSON.stringify({ A: Date.parse(at(9)) }))
check('a waiting video says how many go before it, counting the one on the server', JSON.stringify(placesInLine(order, ['b1', 'a2', 'zz'], 1)) === JSON.stringify({ b1: 2, a2: 4 }))
check('an empty line is empty', fairOrder([]).length === 0)

// ── The month's edited videos ────────────────────────────────────────────────
check('Pro edits 100 videos a month; admin has no limit', REVIEW_EDITS_MONTHLY_CAP === 100 && reviewEditCapFor('pro') === 100 && reviewEditCapFor('admin') === null)
const newMember = new Date(Date.now() - 2 * 86400_000).toISOString()
const oldMember = new Date(Date.now() - 40 * 86400_000).toISOString()
check('25 in the first week, 100 after it', introCap(100, newMember) === 25 && introCap(100, oldMember) === 100)
check('used up is said with when more come, and the first week when it applies', allowanceFullWords({ used: 25, limit: 25, left: 0, resetLabel: 'Dec 3', introNote: 'Your first 7 days run at a quarter of each monthly allowance.' }) === 'You have used all 25 edited videos for this month. More on Dec 3. Your first 7 days run at a quarter of each monthly allowance.')

const S = readFileSync('lib/review-edit-server.ts', 'utf8')
const R = readFileSync('app/api/review-edit/route.ts', 'utf8')
const U = readFileSync('components/review-editor/ReviewEditor.tsx', 'utf8')
const D = readFileSync('components/review-editor/DriveBatch.tsx', 'utf8')
const SUM = readFileSync('app/api/usage/summary/route.ts', 'utf8')
check('one count per edited video, the first time it is read; the transcription’s cost every time', PRIMARY_FEATURE.reviewEdit.join() === 'review_edit_video' && /if \(!row\.info\?\.counted\) recordUsage\(\{ userId: row\.user_id, tier: who\.tier, feature: PRIMARY_FEATURE\.reviewEdit\[0\], model: 'counter', images: 0 \}\)/.test(S) && /feature: 'review_edit_transcribe', model: 'fal-whisper', images: 1/.test(S) && /counted: true \}, words, shots, plan, settings/.test(S))
check('videos added and not read yet count, so a batch never goes past the month', /\.in\('status', \['queued', 'reading'\]\)\.is\('info->counted', null\)/.test(S) && /introCap\(reviewEditCapFor\(t\), subscribedAt\)/.test(S))
check('adding past the month is refused in words', /if \(allowance\.left !== null && allowance\.left <= 0\) return NextResponse\.json\(\{ error: allowanceFullWords\(allowance\), allowanceFull: true/.test(R) && /allowance: await editAllowance\(db, g\.userId, g\.tier\)/.test(R))
check('the video server takes turns, and reads three at most at once', /const next = await nextInLine\(db, 'make'\)/.test(S) && /if \(!row\) row = \(await nextInLine\(db, 'read'\)\) \?\? undefined/.test(S) && /READ_AT_ONCE = 3/.test(S) && /if \(\(reading \?\? 0\) >= READ_AT_ONCE\) break/.test(S) && !/eq\('status', 'ready_to_make'\)\.order\('updated_at', \{ ascending: true \}\)\.limit\(1\)/.test(S))
check('each waiting card says where it stands, from counts only', /placesInLine\(await lineOrder\(db, 'make'\), waitingMake, await busy\('making'\)\)/.test(R) && /videos go'\} before it\. MVP takes turns between members, one video at a time\./.test(U) && /'It is next\.'/.test(U))
check('the page says what is used this month and when it resets', /edited videos used this month/.test(U) && /left=\{allowance\?\.left \?\? null\}/.test(U))
check('a batch bigger than what is left says so first, and stops at the limit saying why once', /so only the first \$\{left\} will be added/.test(D) && /if \(d\.allowanceFull\)/.test(D) && /stop = d\.error/.test(D))
check('the Usage page shows Edited videos once the editor is open to the member', /if \(canUsePreview\('review_edit', tier\)\) push\('reviewEdits', 'Edited videos', await countFeatures\(PRIMARY_FEATURE\.reviewEdit\), introCap\(REVIEW_EDITS_MONTHLY_CAP, subscribedAt\)\)/.test(SUM))

if (fails.length) { console.error(`\n❌ review-edit-queue: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit-queue: turns between members, three reads at once, 100 edited videos a month and 25 in the first week, counted once, said in words')
process.exit(0)
