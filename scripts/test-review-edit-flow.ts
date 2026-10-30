// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE REVIEW EDITOR'S QUEUE AND PAGE (Seb, 2026-10-30). Pinned: Labs only;
// a batch moves by itself in the background, one video on the video server
// at a time, every step claimed so two ticks never do the same work; only
// the sound is sent to be written down; raw uploads are deleted when the
// creator is done or two days after, never while in use; a video made again
// replaces its last files; every stop says why; cheap models, few frames.
import { readFileSync } from 'node:fs'
import { ownPath, MAKING_AT_ONCE, RAW_KEEP_MS } from '../lib/review-edit-server'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')
const W = read('lib/review-edit-server.ts')
const R = read('app/api/review-edit/route.ts')
const C = read('app/api/review-edit/callback/route.ts')
const Q = read('app/api/cron/review-edits/route.ts')
const P = read('lib/review-edit-plan.ts')
const U = read('components/review-editor/ReviewEditor.tsx')
const S = read('ingest-service/server.js')

// ── Labs only ────────────────────────────────────────────────────────────────
check('admin only while it is tested', /review_edit: 'admin'/.test(read('lib/labs-preview.ts')))
check('the route, the page and the menu each check', /canUsePreview\('review_edit'/.test(R) && /canUsePreview\('review_edit'/.test(read('app/(dashboard)/review-editor/page.tsx')) && /href: '\/review-editor'[^\n]*gate: isAdmin/.test(read('components/layout/DashboardShellV2.tsx')))

// ── In the background, one at a time ─────────────────────────────────────────
check('adding a video starts it at once, and the cron carries on', /after\(async \(\) => \{ try \{ await moveQueue\(db, \{ userId: g\.userId/.test(R)
  && (JSON.parse(read('vercel.json')).crons as { path: string; schedule: string }[]).some((c) => c.path === '/api/cron/review-edits' && c.schedule === '*/2 * * * *'))
check('one video on the video server at a time', MAKING_AT_ONCE === 1 && /\(making \?\? 0\) < MAKING_AT_ONCE/.test(W))
check('a read and a make are claimed first, so two ticks never do the same video', /\.eq\('id', row\.id\)\.eq\('status', 'queued'\)\.select\('id'\)/.test(W) && /\.eq\('id', row\.id\)\.eq\('status', 'ready_to_make'\)\.select\('id'\)/.test(W))
check('work that never came back is tried again, then said to have stopped', /READ_STALE_MS/.test(W) && /MAKE_STALE_MS/.test(W) && /MAX_ATTEMPTS/.test(W) && /The video server never finished it/.test(W))
check('the next video starts when the server reports one done', /moveQueue\(db, \{ readBudget: 0 \}\)/.test(C))
check('only a signed job of the editor’s lands in the callback', /x-ingest-secret/.test(C) && /readRenderJob/.test(C) && /startsWith\('edit-'\)/.test(C))
check('a video server that is updating puts the video back in line, not failed', /sent\.status === 404 \|\| sent\.status === 0\) return set\(db, row\.id, \{ status: 'ready_to_make'/.test(W))
check('the cron before the table exists says so instead of failing', /review_edits table not made yet/.test(Q))

// ── Files ────────────────────────────────────────────────────────────────────
check('only the sound goes to be written down, and it is deleted after', /'\/stream-audio'/.test(W) && /transcribeToCues\(audio\.data\.url\)/.test(W) && /remove\(\[audioPath\]\)/.test(W))
check('raw takes go when the creator is done, or two days after it was made, never while in use', RAW_KEEP_MS === 48 * 3600_000 && /if \(BUSY\.includes\(r\.status\)\) continue/.test(W) && /action === 'finish'[\s\S]{0,80}deleteRaw/.test(R))
check('a video made again replaces its last files', /const stale = old\.filter/.test(W) && /remove\(stale\)/.test(W))
check('only this creator’s own files are ever used or deleted', ownPath('https://x.supabase.co/storage/v1/object/public/instagram-videos/u1/source-edit-a.mp4', 'u1') === 'u1/source-edit-a.mp4'
  && ownPath('https://x.supabase.co/storage/v1/object/public/instagram-videos/u2/source-edit-a.mp4', 'u1') === null
  && ownPath('https://x.supabase.co/storage/v1/object/public/instagram-videos/u1/../u2/x.mp4', 'u1') === null)
check('the video server keeps the takes in a folder of the job’s own, removed whatever happens', /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'edit-'\)\)/.test(S) && /finally \{\s*\n\s*try \{ fs\.rmSync\(dir, \{ recursive: true, force: true \}\)/.test(S))
check('finished videos are named for the 30 day clean-up', /edit-\$\{stamp\}-\$\{f\}\.mp4/.test(S) && /edit-\\d\+-\(wide\|vertical\)/.test(read('lib/burn-retention.ts')))

// ── Cost ─────────────────────────────────────────────────────────────────────
check('the plan on Sonnet 5, the B-roll and typed changes on Haiku', /PLAN_MODEL = 'claude-sonnet-5'/.test(P) && /QUICK_MODEL = 'claude-haiku-4-5-20251001'/.test(P) && /model: QUICK_MODEL[\s\S]{0,40}max_tokens: 900/.test(P))
check('the B-roll is seen from 36 small frames, sent in the answer, never stored', /frames: 36, width: 320/.test(W) && /jpg: fs\.readFileSync\(out\)\.toString\('base64'\)/.test(S))
check('every AI call is counted', (P.match(/recordAnthropicUsage\(/g) ?? []).length === 3)

// ── Every stop says why ──────────────────────────────────────────────────────
const fails2 = (W.match(/status: 'failed', note: /g) ?? []).length + (W.match(/return await fail\(/g) ?? []).length
check('each way a video stops writes its reason', fails2 >= 8)
check('the page shows every status in words, and the note under it', ['queued', 'reading', 'ready_to_make', 'making', 'done', 'failed'].every((k) => new RegExp(`${k}: \\{ words: '`).test(U)) && /\{e\.note && <p/.test(U))
check('a cut is never silent: each is listed with why, and can be put back', /What MVP cut/.test(U) && /c\.restored \? 'Cut it again' : 'Put it back'/.test(U))
check('changes are said to need Make it again', /Changes here show once you press Make it again/.test(U))
check('Send to Drop goes through Drop’s own draft', /action: 'draft_start'/.test(U) && /action: 'draft_add', dropId: d\.id/.test(U))

const copy = U.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\$\{[^}]*\}/g, '').match(/'[^'\n]{14,}'|"[^"\n]{14,}"|>[^<>{}\n]{14,}</g)?.join(' ') ?? ''
check('no dashes in what a creator reads', !/[–—]| - /.test(copy))
check('no year in the copy', !/\b20\d\d\b/.test(copy))

if (fails.length) { console.error(`\n❌ review-edit-flow: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit-flow: Labs only, a batch moves by itself one video at a time, raw takes deleted when done, every stop says why')
